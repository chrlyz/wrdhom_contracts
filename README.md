# WrdHom: auditable social-media

This repository hosts the source-code for [Mina](https://github.com/MinaProtocol/mina) smart contracts and zero-knowledge programs, written in [o1js](https://github.com/o1-labs/o1js), to power social-media where users are able to audit their feeds in an easy and inexpensive way at any time.

The internet has become increasingly manipulated by obscure and biased algorithms that show us content based on what opaque third-parties want us to see, according to their own interests, with little to no way for users to customize their experience. These algorithms are often closed-source, or if open-sourced, there’s no way to verify that the open-source code matches the code running on the servers at any time (let alone in real-time).

Auditing a traditional platform requires replicating its whole system with all its data, monitoring the behavior of the original platform, and comparing results. This is unrealistic, since platforms usually just release their source-code partially, not at the same time they deploy it; and access to their data is restrictive. Not to mention that platforms can always find ways to game audits, and the cost of implementing these auditing systems is prohibitive. Leaving users vulnerable to propaganda, censorship (veiled or evident), and harmful algorithms (promoting polarization, echo-chambers, screen-addiction, disinformation, etc).

Furthermore, we need more than guarantees that a specific algorithm is being used. We should be able to create, share, modify, and use our own algorithms, based on our own interests. Exploring content in our own way, without the interference of opaque third-parties.

The purpose of this project is to establish a popular social-media platform that normalizes the expectations for auditability, openness, credible-neutrality, user-owned identity, and composability in our general internet experience. Creating solid foundations for human expression, coordination, and interaction.

## Posts

Posts are the heart of any social media platform. That’s how users get a conversation started, make announcements, share their art, experiences, memes, etc. To implement them, first we start by storing a counter for all posts; the root of a Merkle Map; and the root of another Merkle Map; in 3 of the 8 available Fields for a Mina smart contract, respectively. The counter for all posts will be a Field that will increase by one for every post. The keys for one Merkle Map will be the hashed addresses of users, and the values for the Merkle Map will be a Field that will increase by one for every post by a specific user. The keys for the second Merkle Map will be the result of hashing the address of a user and the contentID for one of its posts, while the values for this Merkle Map will be the hash of the state of the post.

<img src="https://github.com/chrlyz/wrdhom_contracts/blob/main/img/posts_diagram1.png?raw=true&sanitize=true">
<img src="https://github.com/chrlyz/wrdhom_contracts/blob/main/img/posts_diagram2.png?raw=true&sanitize=true">

When a user creates a post, the user generates the contentID for the post and signs it. Then sends the content, signature, user address, and post ContentID to a mempool. After this, the server takes these from the mempool and verifies that everything matches. Then the server assigns a post index based on the counter for all posts, and a post index based on the counter for the posts of that user, ordering the posts at a global level and at a user level. The server also assigns the block length at the time the transaction that updates our on-chain state will be included (if current block length is 100, the server assigns a block length of 100 to the post, and in case the transaction isn’t included in block 101, we would need to build a new proof and transaction, where block length for our post is updated to 101, and try again. To increase the likelihood of our transaction succeeding and avoid doing this extra work and adding lagging to our application, we allow some tolerance in our smart contract, so a post with block length 100 can either be included at block 101 or block 102, although not at block length 103). This logic is executed through a ZkProgram that generates the proof to update the on-chain state. Guaranteeing that all posts are signed, ordered, and timestamped.

Mina also makes it possible to implement a Rollup through convenient recursive proofs, so we don’t have to make an on-chain transaction every time a user sends a post, which would be slow and expensive. Instead, we merge the proofs that we create to update the on-chain state, into a single proof that can be submitted to the network every block (e.g. The server receives 1,000 post requests, so it generates 1,000 proofs that then are merged, and the server uses the resulting proof to update the on-chain state for 1,000 posts in a single transaction).

This way when a user makes a request like “give me all the posts from these users between this time interval”, the server must respond with the appropriate posts, post states, and Merkle Map witnesses (that need to match the on-chain Merkle Map root). Otherwise, the response won’t be valid and the automated client verification will fail, letting the user know that the server is not behaving properly, and possibly manipulating the content it shows by for example shadowbanning, censoring, boosting, or injecting posts.

Following this approach we can implement more features like post deletion; by the user submitting a signed message, targeting a post that the user published before, and the server using this to set the block length at which the post was deleted, signaling that it shouldn’t be stored or delivered anymore, allowing responses that skip that post in a valid way, while still enabling people to prove that the user posted that in the past, and when it was deleted. A post can also be restored after being deleted, by the author signing a message targeting one of their deleted posts, resetting the deletion property to the default.

This project plans to build on these ideas to add even more features, like reactions, reposts, comments, tags, auditable moderation, and more.



## Clone

```console
git clone git@github.com:chrlyz/wrdhom_contracts.git
```

## Install

```console
npm install
```

## Config

Before building, running tests or deploying the project, set some parameters in the `config.json` of the project, and generate keys for the `fee-payer` and the `PostsContract`. To do this start by installing the [zkApp-CLI](https://github.com/o1-labs/zkapp-cli):

```console
npm install -g zkapp-cli
```

Then:

```console
zk config
```

And go through the prompted instructions:

1. Set the name to: `posts`.

2. Set the Mina GraphQL API URL to: `https://proxy.berkeley.minaexplorer.com/graphql`

3. Set transaction fee to: `0.1`

4. Create a new fee-payer key or use one that you already have (just use keys that hold testnet tokens, don’t expose keys holding real tokens that have value, be careful with how you manage your keys).

5. Make sure the fee-payer key has funds to make transactions (the zkApp-CLI will point you to a faucet to request testnet tokens in case you need to).

## Build

```console
npm run build
```

## Run tests

```console
npm run test -- -t 'PostsContract and Posts ZkProgram functionality'
```

## Deploy

To deploy the `PostsContract` on the Berkeley testnet:

```console
node build/src/posts/PostsDeploy.js
```

Wait for the transaction to confirm. Then you can do some test transactions already available in `/src/PostInteract.ts`. To make the first transaction:

```console
node build/src/posts/PostsInteract.js 1
```

Wait for the transaction to confirm, then to make the second transaction:

```console
node build/src/posts/PostsInteract.js 2
```

And so on, up to transaction 4.

Congrats!!! You have successfully deployed the `PostsContract`, and updated the on-chain state for proving the posting and deletion of some posts, through individual and merged proofs, created through the `Posts` ZkProgram.

## License

[MIT](LICENSE)
