import React from "react";
import { Link as RouterLink } from "react-router";
import { Breadcrumbs, Link, Typography } from "@mui/material";
import { NavigateNext as NavigateNextIcon } from "@mui/icons-material";

export type Crumb = { label: string; to?: string };

type Props = {
  // 現在のページまでの階層（最後の要素が現在のページ。ホームは自動で先頭に追加する）
  items: Crumb[];
};

// パンくずリスト（ホーム › シーン › レッスン）
const PageBreadcrumbs: React.FC<Props> = ({ items }) => {
  const crumbs: Crumb[] = [{ label: "ホーム", to: "/" }, ...items];
  const last = crumbs.length - 1;
  return (
    <Breadcrumbs
      aria-label="パンくずリスト"
      separator={<NavigateNextIcon fontSize="small" />}
      sx={{ mb: 2, "& .MuiBreadcrumbs-ol": { flexWrap: "wrap" } }}
    >
      {crumbs.map((c, i) =>
        i === last || !c.to ? (
          <Typography key={`${i}-${c.label}`} color="text.primary" aria-current={i === last ? "page" : undefined} sx={{ overflowWrap: "anywhere" }}>
            {c.label}
          </Typography>
        ) : (
          <Link
            key={`${i}-${c.label}`}
            component={RouterLink}
            to={c.to}
            underline="hover"
            color="inherit"
            sx={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
          >
            {c.label}
          </Link>
        )
      )}
    </Breadcrumbs>
  );
};

export default PageBreadcrumbs;
