# 项目概述
- 后端：Spring Boot 3 + Maven，代码在 backend/ 目录
- 前端：Vue 3，代码在 frontend/ 目录
- 部署：Docker + docker-compose

# 后端结构
- `controller/`：处理 HTTP 请求，定义 API 端点
- `service/`：业务逻辑层，提供接口
- `service/impl`：业务逻辑实现
- `aspect/`：日志切面，生成taskLog
- `config/`：异常处理、JWT配置、鉴权配置
- `component/`: 凌晨四点结算和心跳超时判定
- `entity/`：数据库实体类
- `mapper/`：MyBatis-Plus Mapper接口
- `model/`：Vo、Dto等数据传输对象
- `util/`：Cron表达式处理、JWT工具、Redis工具、Result响应规范

# 前端结构
- `views/`：Vue页面组件，主要是HomeView.vue
- `api/`：与后端API交互的函数



