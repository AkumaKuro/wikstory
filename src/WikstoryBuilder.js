const Wikstory = require('./Wikstory');
const MySQLStrategy = require('./dataSource/MysqlStrategy');

class WikstoryBuilder{

    static types = {
        mysql: 'mysql',
        memory: 'memory'
    }

    withDataSource(type){
        this.type = type;
        return this;
    }

    andClient(client){
        this.client = client;
        return this;
    }

    make(){
        let dataSource;

        switch (this.type) {
            case WikstoryBuilder.types.mysql:
                if (!this.client) throw new Error("A mysql pool is required for this type.");
                dataSource = new MySQLStrategy(this.client);
                break;
            case WikstoryBuilder.types.memory:
                throw new Error("Memory data management is not implemented yet.");
                break;
            default:
                throw new Error("Invalid data source type.")
        }

        return new Wikstory(dataSource);
    }

    static createMySQLPool({
        host,
        user,
        password,
        database,
        waitForConnections,
        connectionLimit,
        queueLimit
    }){
        const {createPool} = require('mysql2/promise');

        return createPool({
            host: host,
            user: user,
            password: password,
            database: database,
            waitForConnections: waitForConnections, //true
            connectionLimit: connectionLimit, //20
            queueLimit: queueLimit, //0
        });
    }
}

module.exports = WikstoryBuilder;