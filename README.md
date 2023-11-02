# Proof Of Events

Break free from obscure algorithms. No more manipulation of the content you see or not see; guided by the private interests and inherent biases of third-parties. Experience social media your way. Customize the criteria for the content you want to see and be certain (through cryptographic proofs) that your criteria is being honored.

Open sourcing algorithms is a step in the right direction, but  it is far from enough, since verifying that the open-sourced code matches the code running on the servers is extremely costly and difficult, given that you would need to mirror the servers of a social media platform, apply the open-sourced algorithm, and compare the results. This is unrealistic, since the cost of even one audit like this would be prohibitive, let alone auditing the system in real-time permanently. Also, most platforms provide little access to their data, so even collecting the data for the audit would be very challenging, and they could implement ways to cheat the auditing.

Furthermore, we need more than guarantees that a specific algorithm is being used. We should be able to create, share, modify, and use our own algorithms, based on our own interests. It’s time to take the internet back and establish solid foundations for human interactions and coordination. Creating digital spaces where we can explore and exchange ideas without the interference of opaque third-parties, imposing their biases and agendas; and constraining the way we explore the internet.

The purpose for this repository is to host the source code for Mina smart contracts and zkPrograms that enable auditable, resilient, customizable, user-centric, and credibly-neutral social media.

## Posts

Posts are the heart of any social media platform. That’s how users get a conversation started, make announcements, share their art, experiences, memes, etc. To implement them, first we start by storing a counter for all posts; the root of a Merkle Map; and the root of another Merkle Map; in 3 of the 8 available Fields for a Mina smart contract, respectively. The counter for all posts will be a Field that will increase by one for every post. The keys for one Merkle Map will be the hashed addresses of users, and the values for the Merkle Map will be a Field that will increase by one for every post by a specific user. The keys for the second Merkle Map will be the result of hashing the address of a user and the contentID for one of its posts, while the values for this Merkle Map will be the hash of the state of the post.

<img src="https://github.com/chrlyz/proof_of_events/blob/main/img/posts_diagram1.png?raw=true&sanitize=true">
<img src="https://github.com/chrlyz/proof_of_events/blob/main/img/posts_diagram2.png?raw=true&sanitize=true">

When a user creates a post, the user generates the contentID for the post and signs it. Then sends the content, signature, user address, and post ContentID to a mempool. After this, the server takes these from the mempool and verifies that everything matches. Then the server assigns a post index based on the counter for all posts, and a post index based on the counter for the posts of that user, ordering the posts at a global level and at a user level. The server also assigns the block length at the time the transaction that updates our on-chain state will be included (if current block length is 100, the server assigns a block length of 100 to the post, and in case the transaction isn’t included in block 101, we would need to build a new proof and transaction, where block length for our post is updated to 101, and try again. To increase the likelihood of our transaction succeeding and avoid doing this extra work and adding lagging to our application, we allow some tolerance in our smart contract, so a post with block length 100 can either be included at block 101 or block 102, although not at block length 103). This logic is executed through a zkProgram that generates the proof to update the on-chain state. Guaranteeing that all posts are signed, ordered, and timestamped.

Mina also makes it possible to implement a Rollup through convenient recursive proofs, so we don’t have to make an on-chain transaction every time a user sends a post, which would be slow and expensive. Instead, we merge the proofs that we create to update the on-chain state, into a single proof that can be submitted to the network every block (e.g. The server receives 1,000 post requests, so it generates 1,000 proofs that then are merged, and the server uses the resulting proof to update the on-chain state for 1,000 posts in a single transaction).

This way when a user makes a request like “give me all the posts from these users between this time interval”, the server must respond with the appropriate posts, post states, and Merkle Map witnesses (that need to match the on-chain Merkle Map root). Otherwise, the response won’t be valid and the automated client verification will fail, letting the user know that the server is not behaving properly, and possibly manipulating the content it shows by for example shadowbanning, censoring, boosting, or injecting posts.

Following this approach we can implement more features like post deletion; by the user submitting a signed message, targeting a post that the user published before, and the server using this to set the block length at which the post was deleted, signaling that it shouldn’t be stored or delivered anymore, allowing responses that skip that post in a valid way, while still enabling people to prove that the user posted that in the past, and when it was deleted. A post can also be restored after being deleted, by the author signing a message targeting one of their deleted posts, resetting the deletion property to the default.

So far we have implemented the smart contract and zkProgram that could enable a server and client to implement the described functionality. This project plans to build on these ideas to add even more features, like reactions, reposts, comments and more.

A successful long-term vision for this project would be establishing a popular social media platform with millions of users. Normalizing the expectations for transparency, auditability, credible neutrality, user-owned identity, resiliency, and composability in our general internet experience.



## Clone

```sh
git clone git@github.com:chrlyz/proof_of_events.git
```

## Install

```sh
npm install
```

## Config

Before building, running tests or deploying the project, configure set some parameters in the `config.json` of the project, and generate keys for the `fee-payer` and the `PostsContract`. To do this start by installing the [zkApp-CLI](https://github.com/o1-labs/zkapp-cli):

```sh
npm install -g zkapp-cli
```

Then:

```sh
zk config
```

And go through the prompted instructions:

1. Set the name to: `test`.

2. Set the Mina GraphQL API URL to: `https://proxy.berkeley.minaexplorer.com/graphql`

3. Set transaction fee to: `0.1`

4. Create a new fee-payer key or use one that you already have (just use keys that hold testnet tokens, don’t expose keys holding real tokens that have value, be careful with how you manage your keys).

5. Make sure the fee-payer key has funds to make transactions (the zkApp-CLI will point you to a faucet to request testnet tokens in case you need to).

## Build

```sh
npm run build
```

## Run tests

```sh
npm run test
npm run testw # watch mode
```

## Deploy

To deploy the `PostsContract` on the Berkeley testnet:

```sh
node build/src/PostsDeploy.js
```

Wait for the transaction to confirm. Then you can do some test transactions already available in `/src/PostInteract.ts`. To make the first transaction:

```sh
node build/src/PostsInteract.js 1
```

Wait for the transaction to confirm, then to make the second transaction:

```sh
node build/src/PostsInteract.js 2
```

And so on, up to transaction 4.

Congrats!!! You have successfully deployed the `PostsContract`, and updated the on-chain state for proving the posting and deletion of some posts, through individual and merged proofs, created through the `Posts` ZkProgram.

## License

[MIT](LICENSE)
