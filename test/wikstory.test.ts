const assert = require('assert');
const errors = require('../Errors');

const SQLTestClass = require('./TestClass');

let testString = `once there was a man
two was a big fan
he jumped off a three
hit his head on the four
barely sur five d
surrounded by six
he avoided going to seven`;

    let changeString = `once there was a man
two was a big fan
he jumped off a three
auiodwiu
awdwadasd
adwdwd
dwadwad
barely sur five d
surrounded by six
he avoided going to seven`;

let thirdString = `once there was a man
two was a big fan
wqewweqeqwe
hit his head on the four
barely sur five d
surrounded by sixasdsasd
he avoided going to seven`;

let fourthString = `dasdawdawdwd`;

let wikstory = null;

describe("Instanciation of wikstory class", function () {
    it("Should create a new instance of wikstory using the test child class.", function () {
        wikstory = new SQLTestClass({
            host: 'localhost',
            user: 'webuser',
            password: 'webuser',
            database: 'wikstory',
            waitForConnections: true,
            connectionLimit: 20,
            queueLimit: 0
        });
    });

    after(async () => {
        await wikstory.delete();
    });
});

describe("Committing and fetching content", function () {
    it("Should create multiple commits using the test strings", async () => {
        await wikstory.commit("test", testString, "noc");
    });

    it("Should be able to return info using", async () => {
        const res = await wikstory.getFileWithCommit('test');

        assert.equal(res.author, 'noc');
        assert.equal(res.file_text, testString);
    });
});

describe("rolling back", function () {

    before(async () => {
        await wikstory.delete();
        await wikstory.commit("test", testString, "noc");
        await wikstory.commit("test", changeString, "noc2");
        await wikstory.commit("test", thirdString, "noc2");
        await wikstory.commit("test", fourthString, "noc3");
        await wikstory.commit("test", changeString, "noc4");
    });
    
    it("should rollback a single time using", async ()=>{
        await wikstory.rollback('test');

        const res = await wikstory.getFileWithCommit('test');
        assert.equal(res.file_text, fourthString);
    });

    it("should fetch a parent commit and rollback to specific commit", async ()=>{
        let res = await wikstory.getFileWithCommit('test');
        let parentHash = await wikstory.getParentCommit(res.commit_hash);

        await wikstory.rollbackToCommit('test', parentHash);

        res = await wikstory.getFileWithCommit('test');
        assert.equal(res.file_text, thirdString);
    });

    it("should rollback all commits from recent author using", async ()=>{
        await wikstory.rollbackUsername('test');

        let res = await wikstory.getFileWithCommit('test');
        assert.equal(res.file_text, testString);
    });
});

describe("testing errors", function () {
    
    before(async () => {
        await wikstory.delete();
        await wikstory.commit("test", testString, "noc");
    });

    it("should throw Identical commit error when text is the same", async ()=> {
        try {
            await wikstory.commit("test", testString, "noc");
        } catch (err) {
            assert(err instanceof errors.IdenticalCommitError);
            return;
        }

        throw new Error("error wasn't thrown for identical commit.");
    });

    it("should throw rollback on initial commit error when rolling back on init commit", async () => {
        try {
            await wikstory.rollback('test');
        } catch (err) {
            assert(err instanceof errors.RollBackOnInitialCommit);
            return;
        }
        throw new Error("error wasn't thrown for rb on initial.");
    });
});

after(async () => {
    await wikstory.delete();
    await wikstory.disconnect();
});