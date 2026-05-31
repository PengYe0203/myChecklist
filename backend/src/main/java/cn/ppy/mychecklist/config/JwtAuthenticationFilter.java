package cn.ppy.mychecklist.config;

import java.io.IOException;
import java.util.ArrayList;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import lombok.extern.slf4j.Slf4j;

import cn.ppy.mychecklist.util.JwtUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

@Component
@Slf4j
public class JwtAuthenticationFilter extends OncePerRequestFilter{

    @Autowired
    private JwtUtils jwtUtils;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        // 获取header，验证格式，并截取token
        String authHeader = request.getHeader("Authorization");
        if (authHeader == null || !authHeader.startsWith("Bearer ")) {
            log.debug("JWT filter: no bearer token, uri={}", request.getRequestURI());
        }
        if(authHeader != null && authHeader.startsWith("Bearer ")) {
            String token = authHeader.substring(7);

            // 验证并解析token
            if(jwtUtils.validateToken(token)){
                Long userId = jwtUtils.getUserIdFromToken(token);

                // 将用户信息放入Security上下文，用于鉴权
                // 目前暂时没设置用户类别及其权限，因此放个空列表
                UsernamePasswordAuthenticationToken authentication =
                    new UsernamePasswordAuthenticationToken(userId, null, new ArrayList<>());

                SecurityContextHolder.getContext().setAuthentication(authentication);
            } else {
                log.debug("JWT filter: token validation failed, uri={}", request.getRequestURI());
            }
        }

        filterChain.doFilter(request, response);
    }

}

    
