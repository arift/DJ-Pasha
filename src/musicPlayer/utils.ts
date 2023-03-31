export const toHoursAndMinutes = (totalSeconds: number) => {
  const totalMinutes = Math.floor(totalSeconds / 60);

  const seconds = String(totalSeconds % 60).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  const hours = Math.floor(totalMinutes / 60);

  return [hours, minutes, seconds].join(":");
};

export function shuffle<T>(array: Array<T>) {
  const newArr = [...array];
  let currentIndex = array.length,
    randomIndex: number;

  // While there remain elements to shuffle.
  while (currentIndex != 0) {
    // Pick a remaining element.
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;

    // And swap it with the current element.
    [newArr[currentIndex], newArr[randomIndex]] = [
      newArr[randomIndex],
      newArr[currentIndex],
    ];
  }

  return newArr;
}

export const random = (min: number, max: number) => {
  return Math.floor(Math.random() * (max - min + 1)) + min;
};

export const getArg = (argument: string, options: Array<any>) => {
  const arg = options.find((val) => {
    const splitVal = val.split("=");
    return splitVal.length > 1 && splitVal[0].trim() === argument;
  });
  if (!arg) {
    return null;
  }

  return arg.split("=").slice(1).join("=");
};

export const getArgv = (argument: string) => {
  return getArg(argument, process.argv);
};

export const formatUsername = (username: string, nickname: string | null) => {
  if (nickname) {
    return `${nickname} (${username})`;
  }
  return username;
};
