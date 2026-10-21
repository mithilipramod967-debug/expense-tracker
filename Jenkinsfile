pipeline {
  agent any
  environment { JWT_SECRET = 'ci' }
  stages {
    stage('Install') { steps { script { run('npm ci') } } }
    stage('Check') { steps { script { run('node --check server.js && node --check core.js && node --check public/app.js') } } }
    stage('Test') { steps { script { run('npm test') } } }
    stage('Build WAR') { steps { script { run('npm run war') }; archiveArtifacts 'expense-tracker.war' } }
    stage('Deploy to Tomcat') {
      steps { script { isUnix() ? sh('cp expense-tracker.war "$CATALINA_HOME/webapps/"') : bat('copy /Y expense-tracker.war "%CATALINA_HOME%\\webapps\\"') } }
    }
  }
}

def run(String cmd) { isUnix() ? sh(cmd) : bat(cmd) }
