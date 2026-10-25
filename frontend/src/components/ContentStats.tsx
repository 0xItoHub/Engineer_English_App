import React from "react";
import { Box, Card, CardContent, Typography } from "@mui/material";
import {
  Layers as LayersIcon,
  PlayArrow as PlayIcon,
  Book as BookIcon,
  Chat as ChatIcon,
} from "@mui/icons-material";
import type { ContentStats as Stats } from "../lib/queries";
import { visuallyHidden } from "../lib/a11y";

type Props = {
  stats: Stats;
};

const ITEMS: { key: keyof Stats; label: string; caption: string; Icon: typeof BookIcon }[] = [
  { key: "scenes", label: "シーン", caption: "開発プロセスに沿った場面", Icon: LayersIcon },
  { key: "lessons", label: "レッスン", caption: "フレーズと対話を収録", Icon: PlayIcon },
  { key: "phrases", label: "フレーズ", caption: "音声読み上げに対応", Icon: BookIcon },
  { key: "dialogues", label: "対話", caption: "順序付きの会話で練習", Icon: ChatIcon },
];

// 収録している教材の数（シーン一覧の取得結果から集計した値を表示する）
const ContentStats: React.FC<Props> = ({ stats }) => (
  <Box component="section" aria-labelledby="content-stats-title" sx={{ mb: 4 }}>
    <Typography id="content-stats-title" component="h2" sx={visuallyHidden}>
      収録コンテンツ
    </Typography>
    <Box
      component="ul"
      sx={{
        listStyle: "none",
        m: 0,
        p: 0,
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", md: "repeat(4, minmax(0, 1fr))" },
        gap: { xs: 2, sm: 3 },
      }}
    >
      {ITEMS.map(({ key, label, caption, Icon }) => (
        <Box component="li" key={key} data-testid={`stat-${key}`}>
          <Card elevation={2} sx={{ height: "100%" }}>
            <CardContent sx={{ textAlign: "center" }}>
              <Icon sx={{ fontSize: 32, color: "primary.main", mb: 0.5 }} aria-hidden="true" />
              <Typography variant="h4" component="p" sx={{ color: "primary.main", fontWeight: 700 }}>
                {stats[key]}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {label}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {caption}
              </Typography>
            </CardContent>
          </Card>
        </Box>
      ))}
    </Box>
  </Box>
);

export default ContentStats;
