module.exports = {
  verbose: true,
  moduleFileExtensions: ['js', 'jsx', 'json', 'ts', 'tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        isolatedModules: true,
        tsconfig: { noImplicitAny: false, strictNullChecks: false, jsx: 'react-jsx' },
      },
    ],
  },
  testMatch: ['<rootDir>/src/**/*.test.[jt]s', '<rootDir>/src/**/*.test.[jt]sx'],
  setupFiles: ['./jest.setup.js'],
};
