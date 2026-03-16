# CI/CD Integration

Run AgentProbe tests automatically in your CI pipeline.

## GitHub Actions

```yaml
# .github/workflows/agent-tests.yml
name: Agent Tests

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci

      - name: Run Agent Tests
        run: npx agentprobe run tests/ -f junit -o results.xml
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}

      - name: Security Scan
        run: npx agentprobe security tests/ --depth standard

      - name: Contract Verification
        run: npx agentprobe contract verify contracts/ --strict

      - name: Compliance Check
        run: npx agentprobe compliance check --framework gdpr

      - name: Upload Results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: agent-test-results
          path: results.xml

      - name: Publish Test Report
        if: always()
        uses: dorny/test-reporter@v1
        with:
          name: AgentProbe Results
          path: results.xml
          reporter: java-junit
```

### Generate Automatically

```bash
agentprobe ci github-actions > .github/workflows/agent-tests.yml
```

## GitLab CI

```yaml
# .gitlab-ci.yml
agent-tests:
  image: node:20
  stage: test
  script:
    - npm ci
    - npx agentprobe run tests/ -f junit -o results.xml
    - npx agentprobe security tests/
    - npx agentprobe contract verify contracts/ --strict
  artifacts:
    reports:
      junit: results.xml
    when: always
  variables:
    OPENAI_API_KEY: $OPENAI_API_KEY
```

### Generate Automatically

```bash
agentprobe ci gitlab > .gitlab-ci.yml
```

## Jenkins

```groovy
// Jenkinsfile
pipeline {
    agent { docker { image 'node:20' } }

    environment {
        OPENAI_API_KEY = credentials('openai-api-key')
    }

    stages {
        stage('Install') {
            steps { sh 'npm ci' }
        }
        stage('Agent Tests') {
            steps {
                sh 'npx agentprobe run tests/ -f junit -o results.xml'
            }
            post {
                always {
                    junit 'results.xml'
                }
            }
        }
        stage('Security') {
            steps {
                sh 'npx agentprobe security tests/ --depth standard'
            }
        }
        stage('Contracts') {
            steps {
                sh 'npx agentprobe contract verify contracts/ --strict'
            }
        }
    }
}
```

### Generate Automatically

```bash
agentprobe ci jenkins > Jenkinsfile
```

## Azure Pipelines

```yaml
# azure-pipelines.yml
trigger:
  branches:
    include: [main]

pool:
  vmImage: ubuntu-latest

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'

  - script: npm ci
    displayName: Install Dependencies

  - script: npx agentprobe run tests/ -f junit -o $(Build.ArtifactStagingDirectory)/results.xml
    displayName: Run Agent Tests
    env:
      OPENAI_API_KEY: $(OPENAI_API_KEY)

  - task: PublishTestResults@2
    condition: always()
    inputs:
      testResultsFormat: JUnit
      testResultsFiles: '$(Build.ArtifactStagingDirectory)/results.xml'
```

## Output Formats for CI

```bash
# JUnit XML (most CI systems)
agentprobe run tests/ -f junit -o results.xml

# JSON (custom processing)
agentprobe run tests/ -f json -o results.json

# HTML dashboard
agentprobe portal -o report.html
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All tests passed |
| `1` | One or more tests failed |
| `2` | Configuration or runtime error |

## Tips

- **Use `--bail`** for fast feedback on PRs — stop on first failure
- **Store API keys as secrets** — never commit them
- **Run security scans on PRs** — catch issues before merge
- **Use `--parallel`** to speed up large test suites
- **Cache `node_modules`** for faster CI runs
- **Use `--retries 2`** for flaky LLM-dependent tests
