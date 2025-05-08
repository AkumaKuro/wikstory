const mysql = require("mysql2/promise");
const crypto = require('crypto');
const zlib = require('zlib');
const Diff = require('diff');

const errors = require('./Errors');

function hashContent(content) {
    return crypto.createHash('sha1').update(content).digest('hex').toUpperCase();
}

function compressString(inputString) {
    return new Promise((resolve, reject) => {
        zlib.gzip(inputString, (err, compressedBuffer) => {
            if (err) {
                reject(err);
            } else {
                resolve(compressedBuffer.toString('base64')); // Convert buffer to base64 for easy storage/transmission
            }
        });
    });
}

function decompressString(compressedString) {
    return new Promise((resolve, reject) => {
        const buffer = Buffer.from(compressedString, 'base64'); // Decode from base64
        zlib.gunzip(buffer, (err, decompressedBuffer) => {
            if (err) {
                reject(err);
            } else {
                resolve(decompressedBuffer.toString()); // Convert buffer back to string
            }
        });
    });
}

class Wikstory{
    constructor({
        host,
        user,
        password,
        database,
        waitForConnections,
        connectionLimit,
        queueLimit
    }){
        this.pool = mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: database,
            waitForConnections: waitForConnections, //true
            connectionLimit: connectionLimit, //20
            queueLimit: queueLimit, //0
        });
    }

    async disconnect() {
        await this.pool.end();
    }

    //read in text file and generate kv pairs
    //comparing incoming kv list with existing to find differences
    //changes set in most recent commit
    async commit(uri, text, userName){
        if (typeof(uri) != "string" || typeof(text) != "string" || typeof(userName) != "string") throw new errors.InvalidInputError("Invalid input: 'uri, text, and userName' must be non-empty strings.");

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

        let prev = await this.#getFile(uri);
        let prevText = prev ? prev.file_text : null;
        let parenthash = prev ? prev.commit_hash : null;

        if (text == prevText) throw new errors.IdenticalCommitError("New commit is identical.");

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

        await this.#saveCommit(commitHash, parenthash, lineChanges, userName);
        for (let i = 0; i < blobHashes.length; i++){
            await this.#saveBlob(blobHashes[i], await compressString(blobLines[i]));
        }
        await this.#saveFile(uri, commitHash, text)

        return commitHash;
    }

    //call rollback until provided commit hash is discovered 
    //if it hits the end of the hash chain without finding the hash it will throw error
    async rollBackToCommit(uri, hash){
        //check commit is in history
        let fileObj = await this.#getFile(uri);
        let checkHash = fileObj.commit_hash;
        if (checkHash == hash){
            //cant roll back to current commit
            return;
        }

        while(checkHash != hash){
            checkHash = await this.getParentCommit(checkHash);
            if ( checkHash == null) {
                //error hash not in chain
                throw new errors.ItemNotFoundError(`Could not find a commit with the hash ${hash} for the URI ${uri}.`);
            }
        }

        while(await this.rollBack(uri) != hash) continue;
    }

    //call rollback until a commit is found with a different author to the most recent author
    //if hits end of hash chain rollBack will throw an error on attempting to delete final commit
    async rollBackUsername(uri){
        let fileCommitObj = await this.getFileWithCommit(uri);
        let author = fileCommitObj.author;
        let checkAuthor = author;

        while(checkAuthor == author){
            let commitHash = await this.rollBack(uri);
            checkAuthor = await this.blame(commitHash);
        }
    }

    //apply line changes to current file backwards to get the prvious commit
    //track lines removed from current file (deletedHashes[])
    //save new file text to file db
    //remove the commit from the top of the commit chain
    //depricate the dependency count based on hashes that were removed
    //call trimBlobs() to remove blobs with no dependencies left
    async rollBack(uri){
        const fileInfo = await this.getFileWithCommit(uri);

        if (!fileInfo.parent_hash){
            throw new errors.RollBackOnInitialCommit("Cannot roll back on the first commit.");
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
                const blob = await this.getBlob(change.hash);
                fileLines.splice(change.line, 0, blob.line_text);
            }
        }

        let fileText = fileLines.join('\n');

        //update db with file
        await this.#saveFile(uri, fileInfo.parent_hash, fileText);
        //remove top level commit
        const query = `DELETE FROM commits WHERE hash = UNHEX(?)`;
        await this.pool.execute(query, [fileInfo.commit_hash]);
        //depricate and delete blobs
        for (const hash of deletedHashes){await this.#depricateBlob(hash);}
        await this.trimBlobs();

        return fileInfo.parent_hash;
    }

    //add file text to the file table alongside it's current commit hash
    async #saveFile(uri, commitHash, fileText){
        if(!uri, !commitHash, !fileText) throw new errors.InvalidInputError("When trying to save a file, empty values were passed.");
        const query = `
			INSERT INTO files (uri, current_commit_hash, file_text)
			VALUES (?, UNHEX(?), ?)
            ON DUPLICATE KEY UPDATE
                current_commit_hash = VALUES(current_commit_hash),
                file_text = VALUES(file_text);
		`;
		const params = [uri, commitHash, fileText];
		await this.pool.execute(query, params);
    }

    //save the new blob alongside it's blob hash
    //upon conflicting blobs update the dependency count by one instead of inserting over
    async #saveBlob(hash, content){
        if(!hash, !content) throw new errors.InvalidInputError("When trying to save a blob, empty values were passed.");
        const query = `
			INSERT INTO blobs (blob_hash, line_text)
			VALUES (UNHEX(?), ?)
            ON DUPLICATE KEY UPDATE dependencies = dependencies + 1
		`;
		const params = [hash, content];

		await this.pool.execute(query, params);
    }

    //save new commit information ti commits table
    async #saveCommit(commitHash, parentHash, lineChanges, author){
        if(!commitHash, !parentHash, !lineChanges, !author) throw new errors.InvalidInputError("When trying to save a commit, empty values were passed.");
        const query = `
			INSERT INTO commits (hash, parent_hash, line_changes, author, commit_date)
			VALUES (UNHEX(?), UNHEX(?), ?, ?, DEFAULT)
		`;
		const params = [commitHash, parentHash, JSON.stringify({changes: lineChanges}), author];

		await this.pool.execute(query, params);
    }

    //get just file information from file table
    //file information:
    //{
    //  currentCommitHash,
    //  fileText
    //}
    async #getFile(uri){
        if (!uri || typeof(uri) != "string") throw new errors.InvalidInputError(`URI must be non-empty string.`);

        const query = `
        SELECT uri, HEX(current_commit_hash) AS commit_hash, file_text
        FROM files
        WHERE uri = ?
        `;
        const [rows] = await this.pool.execute(query, [uri]);

        if (rows.length > 0) {
            return rows[0];
        } else {
            return null;
        }
    }

    //get file information alongside current commit information, more verbose version of getFile
    //file w/ commit info:
    //{
    //  current_commit_hash as commit_hash <String>,
    //  file_ext <String>,
    //  commit_date <String>,
    //  author <String>,
    //  parentHash <String>,
    //  lineChanges <String/json>,
    //}
    async getFileWithCommit(uri){
        if (!uri || typeof(uri) != "string") throw new errors.InvalidInputError(`URI must be non-empty string.`);

        const query = `
            SELECT f.uri, HEX(f.current_commit_hash) AS commit_hash, f.file_text, DATE_FORMAT(c.commit_date, '%d/%m/%Y') AS formatted_date, c.author, HEX(c.parent_hash) AS parent_hash, c.line_changes
            FROM files f
            JOIN commits c ON f.current_commit_hash = c.hash
            WHERE f.uri = ?`;
        const [rows] = await this.pool.execute(query, [uri]);

        if (rows.length > 0){
            return rows[0];
        } else {
            throw new errors.ItemNotFoundError(`Could not find file with URI ${uri}.`);
        }
    }

    //recursively retreive the entire commit history from the commits list 
    //used for management page
    async getCommitHistory(uri){
        if (!uri || typeof(uri) != "string") throw new errors.InvalidInputError(`URI must be non-empty string.`);

        const query = `
        WITH RECURSIVE commit_history AS (
            SELECT
                HEX(c.hash) AS hash,
                HEX(c.parent_hash) AS parent_hash,
                c.author,
                c.commit_date,
                c.line_changes
            FROM files f JOIN commits c ON f.current_commit_hash = c.hash WHERE f.uri = ?

            UNION ALL

            SELECT
                HEX(c.hash) AS hash,
                HEX(c.parent_hash) AS parent_hash,
                c.author,
                c.commit_date,
                c.line_changes
            FROM commits c JOIN commit_history ch ON c.hash = UNHEX(ch.parent_hash)
        )
        SELECT * FROM commit_history;`;

        const [rows] = await this.pool.execute(query, [uri]);

        if (rows.length > 0){
            for(let row in rows) rows[row].line_changes = JSON.parse(rows[row].line_changes);
            return rows;
        } else {
            throw new errors.ItemNotFoundError(`Could not find commit history for ${uri}.`);
        }
    }

    //get hash of given commit's parent
    //used to travel through commit trees
    async getParentCommit(hash){
        if (!hash || typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");

        const query = `
        SELECT HEX(parent_hash) AS parent_hash FROM commits
        WHERE hash = UNHEX(?)`;
        const [rows] = await this.pool.execute(query, [hash]);

        if (rows.length > 0){
            return rows[0].parent_hash;
        } else {
            throw new errors.ItemNotFoundError("Could not find commit with provided hash.");
        }
    }

    //get the 5 most recent entries in the commit tree
    //used to populate the recent entries list on iceberg viewer
    async getRecentCommits(){
        const query = `
        SELECT f.uri
        FROM files f
        JOIN commits c ON f.current_commit_hash = c.hash
        ORDER BY c.commit_date DESC
        LIMIT 5`;
        const [rows] = await this.pool.execute(query);

        if (rows.length > 0){
            return rows;
        } else {
            throw new errors.ItemNotFoundError("Could not find commit with provided hash.");
        }
    }

    //get uncompressed line data from it's hash
    async getBlob(hash){
        if (!hash || typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");

        const query = `
        SELECT line_text FROM blobs
        WHERE blob_hash = UNHEX(?)`;
        
        const [rows] = await this.pool.execute(query, [hash]);

        if (rows.length > 0){
            rows[0].line_text = await decompressString(rows[0].line_text);
            return rows[0];
        } else {
            throw new errors.ItemNotFoundError("Could not find blob with provided hash.");
        }
    }

    //for a given blob reduce it's dependency count by one
    //used when removing commits
    async #depricateBlob(hash){
        if (!hash || typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");
        const query = `UPDATE blobs SET dependencies = dependencies - 1
        WHERE blob_hash = UNHEX(?)`;
        await this.pool.execute(query, [hash]);
    }

    //remove all blobs which are out of dependencies
    async trimBlobs(){
        const query = `DELETE FROM blobs WHERE dependencies < 1`;
        await this.pool.execute(query);
    }

    //change the uri of a given file to a new uri
    async renameFile(oldURI, newURI){
        if (!oldURI || !newURI) throw new Error("One of the provided URIs was empty.");
        const query = `UPDATE files SET uri = ? WHERE uri = ?`;
        await this.pool.execute(query, [newURI, oldURI]);
    }

    //find the author of a specific commit
    async blame(hash){
        if (!hash || typeof(hash) != "string") throw new errors.InvalidInputError("Hash must be non-empty String.");
        const query = `SELECT author FROM commits WHERE hash = UNHEX(?)`;
        let [rows] = await this.pool.execute(query, [hash]);

        if (rows.length > 0){
            return rows[0].author;
        } else {
            throw new errors.ItemNotFoundError("Could not find commit with provided hash.");
        }
    }
}

Wikstory.errors = errors;

module.exports = Wikstory;