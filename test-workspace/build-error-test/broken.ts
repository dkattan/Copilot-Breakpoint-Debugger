// TypeScript file with intentional syntax errors for testing build error capture

function missingReturnType(x: number) {
  // Error: Missing return type annotation
  return x * 2;
}

const invalidSyntax =
  // Error: Unexpected end of expression

  function undeclaredVariable() {
    console.log(nonExistentVar); // Error: Cannot find name 'nonExistentVar'
  };

class BrokenClass {
  // Error: Property has no initializer and is not definitely assigned
  name: string;

  constructor() {
    // Not initializing name
  }

  // Error: Duplicate function implementation
  doSomething() {
    return 1;
  }

  doSomething() {
    return 2;
  }
}

// Error: Type annotation needed
const ambiguous = null;

export { ambiguous, BrokenClass, missingReturnType, undeclaredVariable };
