const fs = require('fs');

// Helper function to convert ALL CAPS to Proper Title Case (e.g., "JOHN" -> "John")
const toTitleCase = (str) => {
    if (!str) return '';
    return str
        .toLowerCase()
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
};

// Read the raw file
const rawData = fs.readFileSync('raw_students.csv', 'utf8');

// Split into lines
const lines = rawData.trim().split('\n');

// Skip the header row and map the rest
const formattedStudents = lines.slice(1).map(line => {
    // Split by comma
    const cols = line.split(',');
    
    // Extract and format each piece
    const studentId = cols[1]?.trim();
    const lastName = toTitleCase(cols[2]?.trim());
    const firstName = toTitleCase(cols[3]?.trim());
    const rawMiddleName = cols[4]?.trim() || '';
    const extName = toTitleCase(cols[5]?.trim()); // For "Jr.", "Sr.", etc.

    // Grab the first letter of the middle name and append a dot (e.g., "GONZALES" -> "G.")
    const middleInitial = rawMiddleName ? rawMiddleName.charAt(0).toUpperCase() + '.' : '';

    // Construct full name (e.g., "Angel G. Arcosiba")
    // filter(Boolean) safely removes any empty pieces (like if there is no middle initial or extension)
    const fullNameParts = [firstName, middleInitial, lastName, extName].filter(Boolean);
    const fullName = fullNameParts.join(' ');

    return `${fullName},${studentId}`;
});

// Add the headers your React frontend expects
const finalCSV = `full_name,student_id\n` + formattedStudents.join('\n');

// Save to a new file
fs.writeFileSync('ready_to_upload.csv', finalCSV);

console.log('✅ Success! Created ready_to_upload.csv with', formattedStudents.length, 'students.');