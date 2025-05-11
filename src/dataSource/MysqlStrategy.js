const mysql = require('mysql2/promise');
const DataSourceInterface = require("./DataSourceInterface");
const zlib = require('zlib');


const errors = require("../../Errors");


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

class MySQLStrategy extends DataSourceInterface {
    constructor(pool){
        super(pool);

        this.pool = pool;
    }

    static createPool({
        host,
        user,
        password,
        database,
        waitForConnections,
        connectionLimit,
        queueLimit
    }){
        return mysql.createPool({
            host: host,
            user: user,
            password: password,
            database: database,
            waitForConnections: waitForConnections, //true
            connectionLimit: connectionLimit, //20
            queueLimit: queueLimit, //0
        });
    }

    async disconnect(){
        await this.pool.end();
    }

    async saveCommit(commitHash, parentHash, lineChanges, author){
        const query = `
            INSERT INTO commits (hash, parent_hash, line_changes, author, commit_date)
            VALUES (UNHEX(?), UNHEX(?), ?, ?, DEFAULT)
        `;
        const params = [commitHash, parentHash, JSON.stringify({changes: lineChanges}), author];

        await this.pool.execute(query, params);
    }

    async saveBlob(hash, content){

        let compressedContent = await compressString(content);

        const query = `
            INSERT INTO blobs (blob_hash, line_text)
            VALUES (UNHEX(?), ?)
            ON DUPLICATE KEY UPDATE dependencies = dependencies + 1
        `;
        const params = [hash, compressedContent];

        await this.pool.execute(query, params);
    }

    async saveFile(uri, commitHash, fileText){
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

    async getFile(uri){
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

    async getFileWithCommit(uri){
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

    async getBlob(hash){
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

    async deleteCommit(commitHash){
        const query = `DELETE FROM commits WHERE hash = UNHEX(?)`;
        await this.pool.execute(query, [commitHash]);
    }

    async depricateBlob(hash){
        const query = `UPDATE blobs SET dependencies = dependencies - 1
        WHERE blob_hash = UNHEX(?)`;
        await this.pool.execute(query, [hash]);
    }

    async trimBlobs(){
        const query = `DELETE FROM blobs WHERE dependencies < 1`;
        await this.pool.execute(query);
    }

    async getParentCommit(hash){
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

    async getRecentCommits(num){
        const query = `
        SELECT f.uri
        FROM files f
        JOIN commits c ON f.current_commit_hash = c.hash
        ORDER BY c.commit_date DESC
        LIMIT ?`;
        const [rows] = await this.pool.execute(query, [num]);

        if (rows.length > 0){
            return rows;
        } else {
            throw new errors.ItemNotFoundError("Could not find commit with provided hash.");
        }
    }

    async getCommitHistory(uri){
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

    async renameFile(oldURI, newURI){
        const query = `UPDATE files SET uri = ? WHERE uri = ?`;
        await this.pool.execute(query, [newURI, oldURI]);
    }

    async blame(hash){
        const query = `SELECT author FROM commits WHERE hash = UNHEX(?)`;
        let [rows] = await this.pool.execute(query, [hash]);

        if (rows.length > 0){
            return rows[0].author;
        } else {
            throw new errors.ItemNotFoundError("Could not find commit with provided hash.");
        }
    }
}

module.exports = MySQLStrategy;