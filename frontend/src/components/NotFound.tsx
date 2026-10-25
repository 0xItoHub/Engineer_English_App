import React from "react";
import { Link as RouterLink } from "react-router";
import { Box, Button, Paper, Typography } from "@mui/material";
import { Home as HomeIcon, SearchOff as SearchOffIcon } from "@mui/icons-material";

// ページやデータが見つからない場合の画面（存在しない URL・ID、API の 404）
const NotFound: React.FC = () => (
  <Box sx={{ display: "flex", justifyContent: "center", mt: 6 }}>
    <Paper elevation={1} sx={{ p: { xs: 3, sm: 5 }, textAlign: "center", maxWidth: 560, width: "100%" }}>
      <SearchOffIcon sx={{ fontSize: 60, color: "text.secondary", mb: 2 }} aria-hidden="true" />
      <Typography variant="h5" component="h1" gutterBottom tabIndex={-1} sx={{ outline: "none" }}>
        ページが見つかりませんでした
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        お探しのページは移動または削除されたか、URL が間違っている可能性があります。
      </Typography>
      <Button variant="contained" component={RouterLink} to="/" startIcon={<HomeIcon />}>
        ホームへ
      </Button>
    </Paper>
  </Box>
);

export default NotFound;
