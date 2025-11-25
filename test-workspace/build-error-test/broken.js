"use strict";
// TypeScript file with intentional syntax errors for testing build error capture
Object.defineProperty(exports, "__esModule", { value: true });
exports.ambiguous = exports.BrokenClass = exports.undeclaredVariable = void 0;
exports.missingReturnType = missingReturnType;
function missingReturnType(x) {
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
    name;
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
exports.BrokenClass = BrokenClass;
// Error: Type annotation needed
const ambiguous = null;
exports.ambiguous = ambiguous;
//# sourceMappingURL=broken.js.map