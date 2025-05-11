const crypto = require('crypto');
const Diff = require('diff');

const DataSourceInterface = require("./dataSource/DataSourceInterface");

const {    InvalidInputError,
    RollBackOnInitialCommit,
    ItemNotFoundError,
    IdenticalCommitError,
    NoConnectError,
    NoDisconnectError} = require('../Errors');


function hashContent(content) {
    return crypto.createHash('sha1').update(content).digest('hex').toUpperCase();
}

class Wikstory {
    constructor(DataStrategy){
        if (!(DataStrategy instanceof DataSourceInterface)) throw new Error("Invalid data strategy class passed to wikstory.");
        this.dataStrategy = DataStrategy;
    }

    async disconnect(){
        await this.dataStrategy.disconnect();
    }
    
    async commit(uri, text, userName){

        if (typeof(uri) != "string" || typeof(text) != "string" || typeof(userName) != "string") throw new InvalidInputError("Invalid input: 'uri, text, and userName' must be non-empty strings.");
    
        let newDict = {};
        let newHashes = [];
        for (const [index, line] of text.split('\n').entries()){
            const hash = hashContent(line);
            newHashes[index] = hash;
            newDict[hash] = line;
        }

        let blobHashes = [];
        let blobLines = [];
        let lineChanges = [];

        let prev = await this.dataStrategy.getFile(uri);
        let prevText = prev ? prev.file_text : null;
        let parenthash = prev ? prev.commit_hash : null;

        if (text == prevText) throw new IdenticalCommitError("New commit is identical.");

        let changes;
        if (prevText == null){
            //in the case of first commit just emulate output of diff algo
            changes = [{
                count: newHashes.length,
                added: true,
                removed: false,
                value: newHashes
            }]
        } else {
            //get the hashes for the previous lines
            let prevHashes = [];
            for (const [index, line] of prevText.split('\n').entries()){
                const hash = hashContent(line);
                prevHashes[index] = hash;
            }

            changes = Diff.diffArrays(prevHashes, newHashes);
        }

        let oldIndex = 0;
        let newIndex = 0;
        for (const change of changes){
            //no change
            if (!change.added && !change.removed){
                oldIndex += change.count;
                newIndex += change.count;
                continue;
            }
            //delete
            if (change.removed){
                for (const hash of change.value){
                    lineChanges.push({
                        line: oldIndex,
                        type: 'del',
                        hash: hash
                    });
                    oldIndex++;
                }
            }
            //add
            if (change.added){
                for (const hash of change.value){
                    lineChanges.push({
                        line: newIndex,
                        type: 'add',
                        hash: hash
                    });
                    newIndex++
                    
                    //add new lines to lists
                    //doesn't matter about dupes as it just increments the dependencies tracker
                    blobHashes.push(hash);
                    blobLines.push(newDict[hash]);
                }
            }
        }

        //do validation checking here first
        
        const obj = {
            uri,
            lineChanges,
            parentHash: parenthash,
            author: userName,
        };
        const commitHash = hashContent(JSON.stringify(obj));

        await this.dataStrategy.saveCommit(commitHash, parenthash, lineChanges, userName);
        for (let i = 0; i < blobHashes.length; i++){
            await this.dataStrategy.saveBlob(blobHashes[i], blobLines[i]);
        }
        await this.dataStrategy.saveFile(uri, commitHash, text)

        return commitHash;
    }

    async rollback(uri){
        const fileInfo = await this.dataStrategy.getFileWithCommit(uri);

        if (!fileInfo.parent_hash){
            throw new RollBackOnInitialCommit("Cannot roll back on the first commit.");
        }

        let fileLines = fileInfo.file_text.split('\n');
        const lineChanges = JSON.parse(fileInfo.line_changes).changes;

        let deletedHashes = [];
        //for adds remove based on line number
        for (const change of lineChanges){
            if (change.type == 'add'){
                //delete relevant lines from fileInfo.file_text
                fileLines[change.line] = null;

                //delete/remove depend for blobs
                deletedHashes.push(change.hash);
            }
        }
        fileLines = fileLines.filter(item => item !== null); //remove null values
        //for deletes insert values from blobs
        for (const change of lineChanges){
            if (change.type == 'del'){
                const blob = await this.dataStrategy.getBlob(change.hash);
                fileLines.splice(change.line, 0, blob.line_text);
            }
        }

        let fileText = fileLines.join('\n');

        //update db with file
        await this.dataStrategy.saveFile(uri, fileInfo.parent_hash, fileText);
        //remove top level commit
        await this.dataStrategy.deleteCommit(fileInfo.commit_hash);
        //depricate and delete blobs
        for (const hash of deletedHashes){await this.dataStrategy.depricateBlob(hash);}
        await this.dataStrategy.trimBlobs();

        return fileInfo.parent_hash;
    }

    async rollbackToCommit(uri, hash){
        //check commit is in history
        let fileObj = await this.dataStrategy.getFile(uri);
        let checkHash = fileObj.commit_hash;
        if (checkHash == hash){
            //cant roll back to current commit
            return;
        }

        while(checkHash != hash){
            checkHash = await this.dataStrategy.getParentCommit(checkHash);
            if ( checkHash == null) {
                //error hash not in chain
                throw new ItemNotFoundError(`Could not find a commit with the hash ${hash} for the URI ${uri}.`);
            }
        }

        while(await this.rollback(uri) != hash) continue;
    }

    async rollbackUsername(uri){
        let fileCommitObj = await this.dataStrategy.getFileWithCommit(uri);
        let author = fileCommitObj.author;
        let checkAuthor = author;

        while(checkAuthor == author){
            let commitHash = await this.rollback(uri);
            checkAuthor = await this.dataStrategy.blame(commitHash);
        }
    }

    async getFileWithCommit(uri){
        if (typeof(uri) != "string") throw new InvalidInputError(`URI must be non-empty string.`);
        
        return await this.dataStrategy.getFileWithCommit(uri);
    }

    async getRecentCommits(num){
        return await this.dataStrategy.getRecentCommits(num);
    }

    async getCommitHistory(uri){
        if (typeof(uri) != "string") throw new errors.InvalidInputError(`URI must be non-empty string.`);

        return await this.dataStrategy.getCommitHistory(uri);
    }

    async getParentCommit(hash){
        if (typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");
        return await this.dataStrategy.getParentCommit(hash);
    }

    async renameFile(oldURI, newURI){
        if (!oldURI || !newURI) throw new Error("One of the provided URIs was empty.");

        this.dataStrategy.renameFile(oldURI, newURI);
    }

    async blame(hash){
        if (typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");
        this.dataStrategy.blame(hash);
    }
}

module.exports = Wikstory;