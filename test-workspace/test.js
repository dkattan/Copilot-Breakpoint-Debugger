console.log("Running test.js inside test-workspace");
console.log(`Current directory: ${require("node:process").cwd()}`);

const randomValue = Math.floor(Math.random() * 100);
console.log(`Random value: ${randomValue}`);

// Deterministic before/after assignment for autoStepOver tests.
let assignedValue = 0;
assignedValue = 1;
console.log(`assignedValue now: ${assignedValue}`);

// Simple loop to provide multiple executable lines for integration test breakpoint placement
for (let i = 0; i < 5; i++) {
  console.log(`Loop iteration ${i}`);
  // Small delay to simulate work
  const start = Date.now();
  while (Date.now() - start < 150) {
    // busy wait
  }
}

console.log("Completed loop");
