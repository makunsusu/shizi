pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  parameters {
    string(name: 'NAS_HOST', defaultValue: '192.168.10.70', description: 'NAS 的局域网 IP 或域名')
    string(name: 'NAS_USER', defaultValue: 'makun', description: '可通过 SSH 登录 NAS 并执行 docker compose 的用户')
    string(name: 'SSH_CREDENTIALS_ID', defaultValue: 'fn-nas-ssh', description: 'Jenkins 中配置的 NAS SSH 私钥凭据 ID')
    string(name: 'DEPLOY_DIR', defaultValue: '/vol3/@appdata/my_apps/shizi/repo', description: 'NAS 上保存项目代码的目录')
    string(name: 'DATA_DIR', defaultValue: '/vol3/@appdata/my_apps/appdata/shizi/data', description: 'NAS 上持久化字卡、音频和字频表的目录')
    string(name: 'CONFIG_DIR', defaultValue: '/vol3/@appdata/my_apps/appdata/shizi/config', description: 'NAS 上持久化 openai 与 tts 配置的目录')
    string(name: 'HEALTH_URL', defaultValue: 'http://127.0.0.1:18081/api/health', description: '容器启动后的健康检查地址')
  }

  stages {
    stage('检查参数') {
      steps {
        script {
          if (!params.NAS_HOST?.trim()) {
            error('请填写 NAS_HOST')
          }
          if (!params.NAS_USER?.trim()) {
            error('请填写 NAS_USER')
          }
          if (!params.SSH_CREDENTIALS_ID?.trim()) {
            error('请填写 SSH_CREDENTIALS_ID')
          }
          if (!params.DEPLOY_DIR?.trim()) {
            error('请填写 DEPLOY_DIR')
          }
          if (!params.DATA_DIR?.trim()) {
            error('请填写 DATA_DIR')
          }
          if (!params.CONFIG_DIR?.trim()) {
            error('请填写 CONFIG_DIR')
          }
        }
      }
    }

    stage('同步代码到 NAS') {
      steps {
        withCredentials([sshUserPrivateKey(
          credentialsId: params.SSH_CREDENTIALS_ID,
          keyFileVariable: 'NAS_SSH_KEY',
          usernameVariable: 'NAS_SSH_USER'
        )]) {
          sh '''
            set -e

            chmod 600 "${NAS_SSH_KEY}"
            TARGET_USER="${NAS_USER:-$NAS_SSH_USER}"
            SSH_OPTIONS="-i ${NAS_SSH_KEY} -o StrictHostKeyChecking=no"

            command -v rsync >/dev/null 2>&1 || {
              echo "Jenkins 节点缺少 rsync，请先安装后重试。"
              exit 1
            }

            ssh ${SSH_OPTIONS} "${TARGET_USER}@${NAS_HOST}" "
              set -e
              command -v rsync >/dev/null 2>&1 || {
                echo 'NAS 缺少 rsync，请先安装后重试。'
                exit 1
              }
              mkdir -p \\"${DEPLOY_DIR}\\" \\"${DATA_DIR}\\" \\"${CONFIG_DIR}\\"
            "

            rsync -az --delete \
              -e "ssh ${SSH_OPTIONS}" \
              --exclude ".git/" \
              --exclude ".codex/" \
              --exclude ".claude/" \
              --exclude "node_modules/" \
              --exclude "*.log" \
              --exclude "config/openai-config.json" \
              --exclude "config/tts-config.json" \
              --exclude "data/" \
              ./ \
              "${TARGET_USER}@${NAS_HOST}:${DEPLOY_DIR}/"
          '''
        }
      }
    }

    stage('部署到 NAS') {
      steps {
        withCredentials([sshUserPrivateKey(
          credentialsId: params.SSH_CREDENTIALS_ID,
          keyFileVariable: 'NAS_SSH_KEY',
          usernameVariable: 'NAS_SSH_USER'
        )]) {
          sh '''
            set -e

            chmod 600 "${NAS_SSH_KEY}"
            TARGET_USER="${NAS_USER:-$NAS_SSH_USER}"

            ssh -i "${NAS_SSH_KEY}" -o StrictHostKeyChecking=no "${TARGET_USER}@${NAS_HOST}" \
              "DEPLOY_DIR=\\"${DEPLOY_DIR}\\" DATA_DIR=\\"${DATA_DIR}\\" CONFIG_DIR=\\"${CONFIG_DIR}\\" HEALTH_URL=\\"${HEALTH_URL}\\" bash -s" <<'REMOTE_SCRIPT'
              set -e

              mkdir -p "${DATA_DIR}/cards" "${DATA_DIR}/audio" "${CONFIG_DIR}"

              if [ ! -f "${CONFIG_DIR}/openai-config.json" ] && [ -f "${DEPLOY_DIR}/config/openai-config.example.json" ]; then
                cp "${DEPLOY_DIR}/config/openai-config.example.json" "${CONFIG_DIR}/openai-config.json"
              fi

              if [ ! -f "${CONFIG_DIR}/tts-config.json" ] && [ -f "${DEPLOY_DIR}/config/tts-config.example.json" ]; then
                cp "${DEPLOY_DIR}/config/tts-config.example.json" "${CONFIG_DIR}/tts-config.json"
              fi

              cd "${DEPLOY_DIR}"
              docker compose up -d --build
              docker compose ps
              docker image prune -f

              attempt=1
              while [ "${attempt}" -le 30 ]; do
                if curl -fsS "${HEALTH_URL}"; then
                  exit 0
                fi

                echo "健康检查未就绪，等待第 ${attempt}/30 次重试..."
                sleep 2
                attempt=$((attempt + 1))
              done

              echo "健康检查超时：${HEALTH_URL}"
              docker compose logs --tail=100 shizi
              exit 1
REMOTE_SCRIPT
          '''
        }
      }
    }
  }

  post {
    success {
      echo "部署成功：${params.HEALTH_URL}"
    }
    failure {
      echo '部署失败，请查看 Jenkins 控制台日志。'
    }
  }
}
