
export {DataSourceInterface};

class DataSourceInterface {
	constructor(client) {
		if (!client) throw new Error("No client passed to data source strategy.");
	}

	async disconnect() {
		throw new Error("Method 'disconnect()' must be implemented.");
	}

	async saveCommit(commitHash, parentHash, lineChanges, author) {
		throw new Error("Method 'saveCommit()' must be implemented.");
	}
	async saveBlob(hash, content) {
		throw new Error("Method 'saveBlob()' must be implemented.");
	}
	async saveFile(uri, commitHash, fileText) {
		throw new Error("Method 'saveFile()' must be implemented.");
	}

	async getFile(uri) {
		throw new Error("Method 'getFile()' must be implemented.");
	}
	async getFileWithCommit(uri) {
		throw new Error("Method 'getFileWithCommit()' must be implemented.");
	}
	async getBlob(hash) {
		throw new Error("Method 'getBlob()' must be implemented.");
	}

	async deleteCommit(commitHash){
		throw new Error("Method 'deleteCommit()' must be implemented.");
	}
	async depricateBlob(hash) {
		throw new Error("Method 'depricateBlob()' must be implemented.");
	}
	async trimBlobs() {
		throw new Error("Method 'trimBlobs()' must be implemented.");
	}
	async getParentCommit(hash) {
		throw new Error("Method 'getParentCommit()' must be implemented.");
	}

	async getRecentCommits(num) {
		throw new Error("Method 'getRecentCommits()' must be implemented.");
	}
	async getCommitHistory(uri) {
		throw new Error("Method 'getCommitHistory()' must be implemented.");
	}

	async renameFile(oldURI, newURI) {
		throw new Error("Method 'renameFile()' must be implemented.");
	}

	async blame(hash) {
		throw new Error("Method 'blame()' must be implemented.");
	}
}