import * as fs from 'fs';
const cliProgress = require('cli-progress');

let { argv } = require("yargs")
  .scriptName("coverageReporter")
  .option("f", {
    alias: "coverageReportFile",
    describe: "Path to coverage report file",
    default: "coverage/index.html",
    type: "string",
    nargs: 1,
  })
  .fail(function (msg: any, err: any, yargs: any) {
    if (err) throw err;
    console.error("Exiting with message")
    console.error(msg);
    console.error(yargs.help())
    process.exit(0);
  })

const IgnoreFiles: string[] = [
  "ftso/mock/",
  "ftso/priceProviderMockContracts/",
  "genesis/mock/",
  "governance/mock/",
  "inflation/mock/",
  "mockXAsset/interface/",
  "mockXAsset/mock/",
  "token/mock/",
  "utils/mock/"
]

interface dataPairs {
  name: string,
  value: string
}

interface fileReport {
  name: string,
  statements_all?: number,
  statements_cov?: number,

  branches_all?: number,
  branches_cov?: number,

  functions_all?: number,
  functions_cov?: number,

  lines_all?: number,
  lines_cov?: number,
}


const reqexMatch = `<span class="[^"]*?[^"]*?">(.*?)<\/span>`
const regexp = new RegExp(reqexMatch, 'g');

const reqexMatch2 = `data-value="([A-Za-z|/]+)"`
const regexp2 = new RegExp(reqexMatch2, 'g');

const percentMatch = `<td data-value="[^"]*?[^"]*?" class="[^"]*?[^"]*?">([0-9]*[.?][0-9]*)%<\/td>`
const regexp3 = new RegExp(percentMatch, 'g');

const ulomekMatch = `<td data-value="[^"]*?[^"]*?" class="[^"]*?[^"]*?">([0-9]*[/][0-9]*)<\/td>`
const regexp4 = new RegExp(ulomekMatch, 'g');

async function main(coverageReportFile: string, save:boolean, saveToFile: string) {
  let data = fs.readFileSync(coverageReportFile, "utf-8");
  let match = data.match(reqexMatch);

  let matchesFound: dataPairs[] = []

  let previous = ""
  let ispair = false
  while ((match = regexp.exec(data)) !== null) {
    if (ispair) {
      matchesFound.push({ name: match[1], value: previous })
      ispair = false
    }
    else {
      previous = match[1];
      ispair = true
    }
  }

  let files_Found: fileReport[] = []

  let match2 = data.match(reqexMatch2);
  let match3 = data.match(percentMatch);
  let match4 = data.match(ulomekMatch);
  let match_title = ""
  while ((match2 = regexp2.exec(data)) !== null) {  
    match_title = match2[1]
    let save_data:fileReport = {name:match_title};
    for(let i = 0; i<4; i++){
      match3 = regexp3.exec(data)
      match4 = regexp4.exec(data)
      if(match4 !== null){
        let splited = match4[1].split("/", 2);
        if(i == 0){
          save_data.statements_all = parseInt(splited[1]);
          save_data.statements_cov = parseInt(splited[0]);
        }
        if(i == 1){
          save_data.branches_all = parseInt(splited[1]);
          save_data.branches_cov = parseInt(splited[0]);
        }
        if(i == 2){
          save_data.functions_all = parseInt(splited[1]);
          save_data.functions_cov = parseInt(splited[0]);
        }
        if(i == 3){
          save_data.lines_all = parseInt(splited[1]);
          save_data.lines_cov = parseInt(splited[0]);
        }
      }
    }
    files_Found.push(save_data)
  }

  if(save){
    fs.writeFileSync(saveToFile, JSON.stringify(matchesFound));
    fs.writeFileSync(saveToFile, JSON.stringify(files_Found));
  }

  let ALL_STATEMENTS = 0
  let COV_STATEMENTS = 0
  let ALL_BRANCHES = 0
  let COV_BRANCHES = 0
  let ALL_FUNCTIONS = 0
  let COV_FUNCTIONS = 0
  let ALL_LINES = 0
  let COV_LINES = 0

  for(let elem of files_Found){
    if(!IgnoreFiles.includes(elem.name)){
      ALL_STATEMENTS += elem.statements_all ? elem.statements_all : 0;
      COV_STATEMENTS += elem.statements_cov ? elem.statements_cov : 0;
      ALL_BRANCHES += elem.branches_all ? elem.branches_all : 0;
      COV_BRANCHES += elem.branches_cov ? elem.branches_cov : 0;
      ALL_FUNCTIONS += elem.functions_all ? elem.functions_all : 0;
      COV_FUNCTIONS += elem.functions_cov ? elem.functions_cov : 0;
      ALL_LINES += elem.lines_all ? elem.lines_all : 0;
      COV_LINES += elem.lines_cov ? elem.lines_cov : 0;
    }
  }

  console.log("Original coverage report");
  
  for(let dataObj of matchesFound){
    console.log(`${dataObj.name} coverage: ${dataObj.value}`);
  }

  console.log("Adjusted coverage report");
  console.log(`Statements coverage: ${(COV_STATEMENTS/ALL_STATEMENTS*100).toFixed(2)}%`);
  console.log(`Branches coverage: ${(COV_BRANCHES/ALL_BRANCHES*100).toFixed(2)}%`);
  console.log(`Functions coverage: ${(COV_FUNCTIONS/ALL_FUNCTIONS*100).toFixed(2)}%`);
  console.log(`Lines coverage: ${(COV_LINES/ALL_LINES*100).toFixed(2)}%`);

}

const { coverageReportFile, saveToFile, save } = argv;
if (!fs.existsSync(coverageReportFile)) {
  console.error("No Coverage report file ");
}

main(coverageReportFile, save, saveToFile)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
