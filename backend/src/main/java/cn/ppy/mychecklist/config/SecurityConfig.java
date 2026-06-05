package cn.ppy.mychecklist.config;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

@Configuration
public class SecurityConfig {

    @Autowired
    private JwtAuthenticationFilter jwtAuthenticationFilter;

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(csrf -> csrf.disable()) // 关闭 CSRF 保护，JWT不需要防止Session攻击
            .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS)) //彻底禁用Session，变为无状态
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/api/auth/**").permitAll() // 登录和注册接口直接放行
                .requestMatchers("/swagger-ui/**", "/v3/api-docs/**").permitAll() // 允许访问Swagger UI和API文档
                .requestMatchers("/api/debug/**").permitAll() // 允许访问调试接口
                .anyRequest().authenticated() // 其他接口需要认证
            );

        //把JWT过滤器放在系统登录验证之前，这样每次请求都会先经过JWT过滤器验证token，验证通过后才会继续执行后续的安全过滤器链
        http.addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder(); //密码加密，使用 BCrypt 算法
    }
}
