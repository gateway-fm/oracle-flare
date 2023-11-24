const fs = require("fs");
import axios from "axios";



const { argv } = require("yargs")
  .scriptName("solhint_badge")
  .option("f", {
    alias: "file-name",
    describe: "name of badge file",
    type: "string",
    default: "solhint_badge.json",
    nargs: 1
  })
  .option("s", {
    alias: "failing",
    describe: "Use this flag to make failing badge",
    type: "boolean",
    default: false,
    nargs: 1
  })

async function main(badgeFileName: string, isFailing:boolean) {
  let BadgeStorageURL = ""
  if (process.env.BADGE_URL) {
    BadgeStorageURL = process.env.BADGE_URL
  }

  let badge_data = {
    "name": "FlareSCSolhint",
    "schemaVersion": 1,
    "label": "Solhint linter",
    "color": "green",
    "message": "Pass"
  }
  if(isFailing){
    badge_data.color = "red";
    badge_data.message = "Fail"
  }
  await axios.post(
    BadgeStorageURL+"api/0/badges",
    badge_data
  )
  // console.log(res)
  // fs.writeFileSync(badgeFileName, JSON.stringify(badge_data))
}

const { fileName, failing } = argv;
main(fileName, failing)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
