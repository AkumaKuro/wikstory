const Wikstory = require('./Wikstory');
const MySQLStrategy = require('./dataSource/MysqlStrategy');

class WikstoryBuilder{

    static types = {
        mysql: 'mysql',
        memory: 'memory'
    }

    withDataSource(type){
        this.type = type;
    }

    andClient(client){
        this.client = client;
    }

    make(){
        let dataSource;

        switch (this.type) {
            case types.mysql:
                if (!this.client) throw new Error("A mysql pool is required for this type.");
                dataSource = new MySQLStrategy(this.client);
                break;
            case types.memory:
                throw new Error("Memory data management is not implemented yet.");
                break;
            default:
                throw new Error("Invalid data source type.")
        }

        return new Wikstory(dataSource);
    }
}

module.exports = WikstoryBuilder;