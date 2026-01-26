console.log("Running test.js inside test-workspace/node");
console.log(`Current directory: ${require("node:process").cwd()}`);

const randomValue = Math.floor(Math.random() * 100);
console.log(`Random value: ${randomValue}`);

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

// Keep process alive long enough for timeout test if invoked via a separate launch config.
// (Normal tests set breakpoints earlier; this section is only reached when no early breakpoints.)
setTimeout(() => {
  console.log("Exiting after idle wait.");
}, 3000);

// Function-type variable for filtering behavior tests
const numberVar = 42;
const fnVar = () => numberVar;
console.log("Function var test", numberVar, typeof fnVar);
