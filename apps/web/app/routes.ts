import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("hot", "routes/hot.tsx"),
  route("story/:id", "routes/story.$id.tsx"),
  route("search", "routes/search.tsx"),
  route("report", "routes/report.tsx"),
] satisfies RouteConfig;
