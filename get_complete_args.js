const fs = require('fs');
const path = require('path');

const brainDir = 'C:\\Users\\usama khadar hersi\\.gemini\\antigravity\\brain';
const folders = fs.readdirSync(brainDir);

let maxLen = 0;
let bestLine = '';
let bestFolder = '';

for (const folder of folders) {
    const logPath = path.join(brainDir, folder, '.system_generated', 'logs', 'transcript.jsonl');
    if (fs.existsSync(logPath)) {
        console.log(`Checking ${logPath}...`);
        const fileContent = fs.readFileSync(logPath, 'utf8');
        const lines = fileContent.split('\n');
        for (const line of lines) {
            if (line.includes('CustomerMenuPage') && !line.includes('<truncated')) {
                if (line.length > maxLen) {
                    maxLen = line.length;
                    bestLine = line;
                    bestFolder = folder;
                    console.log(`New best in ${folder}, length: ${line.length}`);
                }
            }
        }
    }
}

if (bestLine) {
    console.log(`FOUND BEST LINE of length ${maxLen} in folder ${bestFolder}`);
    fs.writeFileSync('C:\\Users\\usama khadar hersi\\.gemini\\antigravity\\brain\\748681f7-1b5e-459c-be52-da8da4fe93b3\\scratch\\raw_best_line.txt', bestLine);
    console.log("Saved best line to raw_best_line.txt");
} else {
    console.log("No untruncated CustomerMenuPage line found.");
}
