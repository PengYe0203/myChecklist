package cn.ppy.mychecklist;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@MapperScan("cn.ppy.mychecklist.mapper")
public class MychecklistApplication {

	public static void main(String[] args) {
		SpringApplication.run(MychecklistApplication.class, args);
	}

}
