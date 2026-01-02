/**
 * Mock Data Generator for ASAL Due Diligence App
 * Generates 20 test clients with all fields filled
 */

const DB_NAME = "asal_dd_db";
const DB_VER = 1;
const STORE_CLIENTS = "clients";

// Sample data arrays
const firstNames = [
  "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
  "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
  "Thomas", "Sarah", "Christopher", "Karen"
];

const lastNames = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
  "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas", "Taylor",
  "Moore", "Jackson", "Martin", "Lee"
];

const streets = [
  "123 Main St", "456 Oak Ave", "789 Elm Dr", "321 Pine Rd", "654 Maple Ln",
  "987 Cedar Way", "147 Birch St", "258 Spruce Ave", "369 Willow Dr", "741 Ash Rd"
];

const cities = [
  "Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Parma", "Canton"
];

const employers = [
  "Walmart Distribution Center", "Amazon Fulfillment", "Nationwide Insurance", "Ohio State University",
  "Honda Manufacturing", "Kroger", "Target", "Home Depot", "Lowe's", "FedEx Ground",
  "UPS", "McDonald's", "Starbucks", "CVS Pharmacy", "Walgreens", "Meijer",
  "Giant Eagle", "Kohl's", "Macy's", "Best Buy"
];

const filingStatuses = [
  "Single", "Head of Household", "Married Filing Jointly", "Married Filing Separately", "Qualifying Surviving Spouse"
];

const dependentNames = [
  "Emma", "Noah", "Olivia", "Liam", "Ava", "Mason", "Sophia", "Jacob",
  "Isabella", "Ethan", "Mia", "Michael", "Charlotte", "Daniel", "Amelia", "Matthew"
];

const relationships = ["Son", "Daughter", "Niece", "Nephew", "Grandson", "Granddaughter"];

const schools = [
  "Columbus Elementary", "Lincoln Middle School", "Washington High", "Roosevelt Elementary",
  "Jefferson Middle", "Franklin High", "Madison Elementary", "Adams Middle"
];

function randomItem(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDate(start, end) {
  const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
  return date.toISOString().slice(0, 10);
}

function randomPhone() {
  return `(614) ${randomInt(200, 999)}-${randomInt(1000, 9999)}`;
}

function randomEmail(first, last) {
  const domains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];
  return `${first.toLowerCase()}.${last.toLowerCase()}@${randomItem(domains)}`;
}

function randomSSN() {
  return randomInt(1000, 9999).toString();
}

function generateDependent(index) {
  const name = randomItem(dependentNames);
  const dob = randomDate(new Date(2010, 0, 1), new Date(2020, 11, 31));
  return {
    name: `${name} ${randomItem(lastNames)}`,
    dob: dob,
    ssn_last4: randomSSN(),
    relationship: randomItem(relationships),
    months_lived: randomInt(7, 12).toString(),
    school_name: randomItem(schools),
    school_address: `${randomInt(100, 999)} School St, ${randomItem(cities)}, OH ${randomInt(43000, 45000)}`,
    other_parent: Math.random() > 0.5 ? `Other Parent, ${randomPhone()}` : "",
    notes: Math.random() > 0.7 ? "Custody agreement on file. Shared custody arrangement." : ""
  };
}

function generateClient(index) {
  const firstName = firstNames[index % firstNames.length];
  const lastName = lastNames[index % lastNames.length];
  const name = `${firstName} ${lastName}`;
  const baseTime = Date.now() - (randomInt(0, 90) * 24 * 60 * 60 * 1000);
  
  // Some clients have dependents, some don't
  const hasDependents = index % 3 !== 0; // ~67% have dependents
  const numDependents = hasDependents ? randomInt(1, 3) : 0;
  const dependents = [];
  for (let i = 0; i < numDependents; i++) {
    dependents.push(generateDependent(i));
  }

  const filingStatus = randomItem(filingStatuses);
  const isSelfEmployed = index % 4 === 0; // 25% are self-employed
  const city = randomItem(cities);
  const street = randomItem(streets);
  
  const client = {
    id: `c_${Date.now()}_${index}_${Math.random().toString(16).slice(2, 8)}`,
    createdAt: baseTime,
    updatedAt: baseTime + randomInt(0, 7) * 24 * 60 * 60 * 1000,
    status: "ready",
    name: name,
    phone: randomPhone(),
    email: randomEmail(firstName, lastName),
    ssn_last4: randomSSN(),
    dob: randomDate(new Date(1970, 0, 1), new Date(1995, 11, 31)),
    filing_status: filingStatus,
    address: `${street}, ${city}, OH ${randomInt(43000, 45000)}`,
    moved_12mo: index % 5 === 0 ? "Yes" : "No",
    id_type: randomItem(["Driver's License", "State ID", "Passport"]),
    id_exp: randomDate(new Date(2025, 0, 1), new Date(2028, 11, 31)),
    notes: `Client ${index + 1}. ${index % 3 === 0 ? "Returning client from previous year." : "New client for tax season."} ${index % 4 === 0 ? "Has prior-year audit history - all documents verified." : ""}`,
    dependents: dependents,
    income: {
      w2_employer: isSelfEmployed ? "" : randomItem(employers),
      w2_address: isSelfEmployed ? "" : `${randomItem(streets)}, ${city}, OH ${randomInt(43000, 45000)}`,
      self_employed: isSelfEmployed ? "Yes" : "No",
      business_type: isSelfEmployed ? randomItem(["Rideshare (Uber/Lyft)", "Cleaning services", "Trucking", "Sales", "Consulting", "Construction"]) : "",
      income_notes: isSelfEmployed 
        ? `Self-employed ${randomItem(["full-time", "part-time"])}. Average weekly income: $${randomInt(400, 1200)}. Works ${randomInt(20, 50)} hours per week.`
        : `W-2 employee. Annual income approximately $${randomInt(25000, 75000)}. Works ${randomInt(30, 40)} hours per week.`,
      expense_notes: isSelfEmployed
        ? `Mileage: ${randomInt(5000, 25000)} miles. Phone: $${randomInt(50, 150)}/month. Supplies: $${randomInt(200, 1000)}/year.`
        : "Standard W-2 employment, no business expenses."
    },
    ddq: {
      child_lived_half_year: hasDependents ? "Yes" : "N/A",
      anyone_else_claim: hasDependents ? (index % 7 === 0 ? "Yes" : "No") : "N/A",
      pays_household_costs: "Yes",
      missing_ids: index % 10 === 0 ? "Yes" : "No",
      docs: `Photo ID (${randomItem(["Driver's License", "State ID", "Passport"])}) verified. ${hasDependents ? "Birth certificates for all dependents. School enrollment letters. Medical records. " : ""}${isSelfEmployed ? "1099 forms. Business expense receipts. " : "W-2 forms. "}Lease agreement. Utility bills (electric, water). Bank statements.`,
      preparer_notes: `All documents reviewed and verified on ${new Date(baseTime).toLocaleDateString()}. ${hasDependents ? "Dependent residency confirmed through school records and medical documents. " : ""}${isSelfEmployed ? "Self-employment income verified through bank deposits and 1099 forms. " : "W-2 income verified. "}Client attestation signed. All required due diligence questions answered.`
    }
  };

  return client;
}

async function generateAndStoreMockData() {
  try {
    // Open database
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Generate 20 clients
    const clients = [];
    for (let i = 0; i < 20; i++) {
      clients.push(generateClient(i));
    }

    // Store clients
    const store = db.transaction(STORE_CLIENTS, "readwrite").objectStore(STORE_CLIENTS);
    const promises = clients.map(client => {
      return new Promise((resolve, reject) => {
        const req = store.put(client);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      });
    });

    await Promise.all(promises);
    db.close();

    return {
      success: true,
      count: clients.length,
      message: `Successfully generated and stored ${clients.length} mock clients!`
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: `Error: ${error.message}`
    };
  }
}

// Export for use in browser console or HTML page
if (typeof window !== 'undefined') {
  window.generateMockData = generateAndStoreMockData;
}

// For Node.js testing (if needed)
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { generateClient, generateAndStoreMockData };
}

