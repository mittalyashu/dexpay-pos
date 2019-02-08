const resolvers = {
  Mutation: {
    setPosAddress: (_, variables, { cache }) => {
      const data = {
        __typename: 'pos',
        address: variables.address,
        pos: {
          address: variables.address,
          __typename: 'pos'
        }
      };

      cache.writeData({ data });
      return data;
    }
  }
};

export default resolvers;
