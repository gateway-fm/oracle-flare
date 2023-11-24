import path from "path";
import { TestExample } from "./FTSO-test-utils";

const fs = require('fs');

export class TestExampleLogger {
    _logDir: string = "test_logs";
    _fname!: string;
    _filePath!: string;

    constructor(example: TestExample, logDir = "test_logs") {
        this._logDir = logDir;
        this._fname = example.fileName || "no-name.json";
        if (!fs.existsSync(this._logDir)){
            fs.mkdirSync(this._logDir);
        }
        fs.writeFileSync(this.filePath, "");
    }

    get filePath(): string {
        return path.join(this._logDir, this._fname + ".txt");
    }

    log(data: any, newLine = true) {
        fs.appendFileSync(this.filePath, data.toString() + (newLine ? "\n" : ""));
    }
}
