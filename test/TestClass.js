const Wikstory = require("../wikstory");

class WikstoryTestClass extends Wikstory {
    constructor(config) {
        super(config);
    }

    async delete(){
        console.log("deleting");
        //testing
        let query = `DELETE FROM blobs`;
        await this.pool.execute(query);
        query = `DELETE FROM files`;
        await this.pool.execute(query);
        query = `SET FOREIGN_KEY_CHECKS = 0;`;
        await this.pool.execute(query);
        query = `DELETE FROM commits;`;
        await this.pool.execute(query);
        query = `SET FOREIGN_KEY_CHECKS = 1;`;
        await this.pool.execute(query);
    }
}

module.exports = WikstoryTestClass;