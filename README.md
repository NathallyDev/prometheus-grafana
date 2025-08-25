# prometheus-grafana
Monitoring an application using Grafana+Prometheus
## Como usar

Pré-requisitos: Docker e Docker Compose instalados.

1. Subir containers:

	- No Windows PowerShell, rode:

	  docker compose up -d

2. Acessar serviços:

	- Grafana: http://localhost:3000 (usuário: admin / senha: admin)
	- Prometheus: http://localhost:9090

3. O Grafana já vem com um datasource provisionado apontando para o Prometheus e um dashboard básico em `grafana/dashboards`.

Notas:

- A configuração do Prometheus fica em `prometheus/prometheus.yml`.
- Se alterar `grafana/grafana.ini` ou os arquivos em `grafana/provisioning`, reinicie o container do Grafana.

Problemas comuns:

- Se não conseguir acessar, verifique se as portas 3030 e 9090 não estão em uso por outros serviços.
- Para alterar as credenciais, modifique as variáveis de ambiente em `docker-compose.yml`.
