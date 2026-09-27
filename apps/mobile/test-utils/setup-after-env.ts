import { configure } from "@testing-library/react-native";

// findBy*/waitFor give up after 1 s by default, too little when turbo runs every package's tests at once.
configure({ asyncUtilTimeout: 5000 });
