export {
    InvalidInputError,
    RollBackOnInitialCommit,
    ItemNotFoundError,
    IdenticalCommitError,
    NoConnectError,
    NoDisconnectError
}

class InvalidInputError extends Error{
    constructor(message) {
        super(message);
        this.name = "InvalidInputError";
    }
}

class RollBackOnInitialCommit extends Error{
    constructor(message){
        super(message);
        this.name = "RollBackOnInitialCommit";
    }
}

class ItemNotFoundError extends Error{
    constructor(message){
        super(message);
        this.name = "ItemNotFoundError";
    }
}

class IdenticalCommitError extends Error{
    constructor(message){
        super(message);
        this.name = "IdenticalCommitError";
    }
}

class NoConnectError extends Error{
    constructor(message){
        super(message);
        this.name = "NoConnectError";
    }
}

class NoDisconnectError extends Error{
    constructor(message){
        super(message);
        this.name = "NoDisconnectError";
    }
}

