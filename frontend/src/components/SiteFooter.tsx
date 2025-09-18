import React from "react";
import { Box, Container, Divider, Link as MuiLink, Stack, Typography } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

const SiteFooter: React.FC = () => {
  const year = new Date().getFullYear();
  return (
    <Box component="footer" sx={{ mt: 8, borderTop: (theme) => `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper' }}>
      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Engineer English Inc.
          </Typography>
          <Stack direction="row" spacing={3}>
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
        <Typography variant="caption" color="text.secondary">
          © {year} Engineer English Inc. All rights reserved.
        </Typography>
      </Container>
    </Box>
  );
};

export default SiteFooter; 