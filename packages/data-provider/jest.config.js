module.exports = {
  collectCoverageFrom: ['src/**/*.{js,jsx,ts,tsx}', '!<rootDir>/node_modules/'],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageReporters: ['text', 'cobertura'],
  testResultsProcessor: 'jest-junit',
  moduleNameMapper: {
    '^@src/(.*)$': '<rootDir>/src/$1',
  },
  restoreMocks: true,
};
