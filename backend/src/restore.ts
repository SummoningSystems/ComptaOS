import { restoreBackup } from "./services/backupService.js";
const [archive,target]=process.argv.slice(2);
if(!archive||!target){console.error("Usage: node dist/restore.js archive.jsonl.gz empty-destination");process.exitCode=1;}
else await restoreBackup(archive,target);
