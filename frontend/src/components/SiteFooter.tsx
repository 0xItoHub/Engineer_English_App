import React from "react";
import { Box, Container, Divider, Link as MuiLink, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router";

const SiteFooter: React.FC = () => {
  const year = new Date().getFullYear();
  return (
    <Box component="footer" sx={{ mt: 8, borderTop: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
      {/* スマートフォンでは右下のチャットボタンに重ならないよう、下側の余白を広げる */}
      <Container maxWidth="lg" sx={{ pt: 4, pb: { xs: 11, sm: 4 } }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' } }}
        >
          <Typography variant="subtitle1" component="p" sx={{ fontWeight: 600 }}>
            Engineer English App（個人開発）
          </Typography>
          <Stack component="nav" aria-label="フッターナビゲーション" direction="row" sx={{ flexWrap: 'wrap', columnGap: 3, rowGap: 1 }}>
            <MuiLink component={RouterLink} to="/terms" underline="hover" color="inherit">
              利用規約
            </MuiLink>
            <MuiLink component={RouterLink} to="/privacy" underline="hover" color="inherit">
              プライバシーポリシー
            </MuiLink>
            <MuiLink component={RouterLink} to="/contact" underline="hover" color="inherit">
              お問い合わせ
            </MuiLink>
          </Stack>
        </Stack>
        <Divider sx={{ my: 2 }} />
        <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
          © {year} Engineer English App
        </Typography>
      </Container>
    </Box>
  );
};

export default SiteFooter; 