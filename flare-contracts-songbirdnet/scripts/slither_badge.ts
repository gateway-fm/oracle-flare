const fs = require("fs");
import axios from "axios";


const { argv } = require("yargs")
  .scriptName("slither_badge")
  .option("f", {
    alias: "file-name",
    describe: "name of badge file",
    type: "string",
    default: "slither_badge.json",
    nargs: 1
  })
  .option("s", {
    alias: "source-file",
    describe: "name of slither source file file",
    type: "string",
    default: "slither.json",
    nargs: 1
  })

async function main(badgeFileName: string, sourceFileName: string) {
  let BadgeStorageURL = ""
  if (process.env.BADGE_URL) {
    BadgeStorageURL = process.env.BADGE_URL
  }

  const json = fs.readFileSync(sourceFileName, 'utf-8');
  const data = JSON.parse(json);

  if (!data.success) {
      console.error("Problem running Slither.");
      const badge_data = {
          "name": "FlareSCSlither",
          "schemaVersion": 1,
          "label": "Slither",
          "color": "red",
          "message": "Fail"
      }
      await axios.post(
          BadgeStorageURL+"api/0/badges",
          badge_data
        )
      // fs.writeFileSync(badgeFileName,JSON.stringify(badge_data))
  }
  
  else if (data.success) {
      const badge_data = {
          "name": "FlareSCSlither",
          "schemaVersion": 1,
          "label": "Slither",
          "color": "green",
          "message": "Pass"
      }
      await axios.post(
          BadgeStorageURL+"api/0/badges",
          badge_data
        )
      // fs.writeFileSync(badgeFileName,JSON.stringify(badge_data))
  }
}

const { fileName, sourceFile } = argv;
main(fileName, sourceFile)
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
