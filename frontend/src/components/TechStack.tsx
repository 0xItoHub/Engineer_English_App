import React from "react";
import { Box, Card, CardContent, Chip, Link, Typography } from "@mui/material";
import { GitHub as GitHubIcon } from "@mui/icons-material";

const REPOSITORY_URL = "https://github.com/0xItoHub/Engineer_English_App";

// このアプリを構成している技術
const STACK: { title: string; items: string[] }[] = [
  {
    title: "フロントエンド",
    items: ["React 19", "TypeScript", "Vite", "MUI", "TanStack Query", "React Router"],
  },
  {
    title: "バックエンド",
    items: ["Django 5.2 LTS", "Django REST framework"],
  },
  {
    title: "インフラ・CI/CD",
    items: ["AWS Lambda（コンテナ）", "API Gateway", "CloudFront + S3", "Terraform", "GitHub Actions"],
  },
];

const TechStack: React.FC = () => (
  <Card component="section" aria-labelledby="tech-stack-title" elevation={2} sx={{ mt: 6 }}>
    <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
      <Typography id="tech-stack-title" variant="h6" component="h2" gutterBottom>
        技術スタック
      </Typography>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "repeat(3, minmax(0, 1fr))" },
          gap: { xs: 2, md: 3 },
          mt: 1,
        }}
      >
        {STACK.map((group) => (
          <Box key={group.title}>
            <Typography
              variant="subtitle2"
              component="h3"
              sx={{ borderLeft: 3, borderColor: "primary.main", pl: 1.5, mb: 1.5 }}
            >
              {group.title}
            </Typography>
            <Box
              component="ul"
              aria-label={group.title}
              sx={{ listStyle: "none", m: 0, p: 0, display: "flex", flexWrap: "wrap", gap: 1 }}
            >
              {group.items.map((item) => (
                <li key={item}>
                  <Chip label={item} size="small" variant="outlined" />
                </li>
              ))}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 3 }}>
        <Link
          href={REPOSITORY_URL}
          target="_blank"
          rel="noopener noreferrer"
          underline="hover"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
        >
          <GitHubIcon fontSize="small" aria-hidden="true" />
          ソースコード（GitHub）
          <Box component="span" sx={{ fontSize: "0.75rem", color: "text.secondary" }}>
            （新しいタブで開きます）
          </Box>
        </Link>
      </Box>
    </CardContent>
  </Card>
);

export default TechStack;
