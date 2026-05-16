---
name: gen-test
description: Generate Vitest tests for a source file following project conventions
disable-model-invocation: true
---

Generate tests for: $ARGUMENTS

## Test Conventions

Follow patterns from existing tests in `tests/unit/`:

- **Framework**: Vitest (`describe`, `it`, `expect`)
- **Imports**: Use `@/` path aliases (e.g., `import { fn } from '@/sim/npc-sim'`)
- **Structure**: One `describe` block per exported function/class, nested `it` blocks for cases
- **Naming**: `it('description of behavior')` — describe what it does, not the input
- **Edge cases**: Test boundaries (0, 1, negative, overflow), determinism (same seed = same output), and invalid inputs
- **Mocking**: Use `vi.fn()` for canvas contexts; see existing tests for patterns

## Steps

1. Read the source file at the path given
2. Identify all exported functions and classes
3. For each export, generate:
   - Happy path tests
   - Edge case tests (boundary values, empty inputs)
   - Error/invalid input tests where applicable
4. Place output in `tests/unit/<filename>.test.ts`
5. Run `npx vitest run tests/unit/<filename>.test.ts` to verify all tests pass
6. Report results
