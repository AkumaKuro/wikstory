export {SQLTestClass}

import {Wikstory} from '../src/Wikstory'
import {WikstoryBuilder} from '../src/WikstoryBuilder'
import {MySQLStrategy} from '../src/dataSource/MysqlStrategy'


class TestSQLStrategy extends MySQLStrategy {
    constructor(config){
        let pool = WikstoryBuilder.createMySQLPool(config);
        super(pool);
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

class SQLTestClass extends Wikstory {
    constructor(config) {
        let testSQLStrategy = new TestSQLStrategy(config);

        super(testSQLStrategy);
    }

    async delete(){
        await this.dataStrategy.delete();
    }
}