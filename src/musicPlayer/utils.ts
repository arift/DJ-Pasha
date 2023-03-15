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
