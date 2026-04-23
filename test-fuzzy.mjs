const justifications = {
  'EDWAR RANGEL-1776945253290': { type: 'BREAKFAST' },
  'ARLEY GABRIEL GIRALDO VELEZ-1776947133247': { type: 'BREAKFAST' },
  'JHON JAMER CORDOBA CORDOBA-1776952304640': { type: 'BREAKFAST' }
};

const timestamp = 1776945253290; // The timestamp for EDWAR RANGEL at 06:54
const packerName = "EDWAR SAMUEL RANGEL RANGEL";

const incidentId = `${packerName}-${timestamp}`;

let justification = justifications[incidentId];
console.log("Exact match:", justification);

if (!justification) {
    const matchingKey = Object.keys(justifications).find(key => {
        const match = key.match(/-(\d{10,14})$/);
        console.log("Testing key:", key, "Match:", match ? match[1] : "None");
        if (match) {
            const keyTs = parseInt(match[1]);
            const isMatch = Math.abs(keyTs - timestamp) <= 70000;
            const keyNameParts = key.split('-')[0].toUpperCase().split(/\s+/).filter(p => p.length > 2);
            const incNameParts = packerName.toUpperCase().split(/\s+/).filter(p => p.length > 2);
            const packerMatch = keyNameParts.some(p => incNameParts.includes(p)) || incNameParts.some(p => keyNameParts.includes(p));
            
            console.log("KeyTs:", keyTs, "TargetTs:", timestamp, "isMatch:", isMatch, "packerMatch:", packerMatch);
            return isMatch && packerMatch;
        }
        return false;
    });
    console.log("Matching Key found:", matchingKey);
    if (matchingKey) {
        justification = justifications[matchingKey];
    }
}

console.log("Final justification:", justification);
