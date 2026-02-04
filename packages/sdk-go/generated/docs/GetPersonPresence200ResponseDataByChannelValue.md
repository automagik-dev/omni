# GetPersonPresence200ResponseDataByChannelValue

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Identities** | [**[]GetPersonPresence200ResponseDataIdentitiesInner**](GetPersonPresence200ResponseDataIdentitiesInner.md) |  | 
**MessageCount** | **int32** |  | 
**LastSeenAt** | **NullableTime** |  | 

## Methods

### NewGetPersonPresence200ResponseDataByChannelValue

`func NewGetPersonPresence200ResponseDataByChannelValue(identities []GetPersonPresence200ResponseDataIdentitiesInner, messageCount int32, lastSeenAt NullableTime, ) *GetPersonPresence200ResponseDataByChannelValue`

NewGetPersonPresence200ResponseDataByChannelValue instantiates a new GetPersonPresence200ResponseDataByChannelValue object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonPresence200ResponseDataByChannelValueWithDefaults

`func NewGetPersonPresence200ResponseDataByChannelValueWithDefaults() *GetPersonPresence200ResponseDataByChannelValue`

NewGetPersonPresence200ResponseDataByChannelValueWithDefaults instantiates a new GetPersonPresence200ResponseDataByChannelValue object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetIdentities

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetIdentities() []GetPersonPresence200ResponseDataIdentitiesInner`

GetIdentities returns the Identities field if non-nil, zero value otherwise.

### GetIdentitiesOk

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetIdentitiesOk() (*[]GetPersonPresence200ResponseDataIdentitiesInner, bool)`

GetIdentitiesOk returns a tuple with the Identities field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetIdentities

`func (o *GetPersonPresence200ResponseDataByChannelValue) SetIdentities(v []GetPersonPresence200ResponseDataIdentitiesInner)`

SetIdentities sets Identities field to given value.


### GetMessageCount

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetMessageCount() int32`

GetMessageCount returns the MessageCount field if non-nil, zero value otherwise.

### GetMessageCountOk

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetMessageCountOk() (*int32, bool)`

GetMessageCountOk returns a tuple with the MessageCount field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMessageCount

`func (o *GetPersonPresence200ResponseDataByChannelValue) SetMessageCount(v int32)`

SetMessageCount sets MessageCount field to given value.


### GetLastSeenAt

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetLastSeenAt() time.Time`

GetLastSeenAt returns the LastSeenAt field if non-nil, zero value otherwise.

### GetLastSeenAtOk

`func (o *GetPersonPresence200ResponseDataByChannelValue) GetLastSeenAtOk() (*time.Time, bool)`

GetLastSeenAtOk returns a tuple with the LastSeenAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastSeenAt

`func (o *GetPersonPresence200ResponseDataByChannelValue) SetLastSeenAt(v time.Time)`

SetLastSeenAt sets LastSeenAt field to given value.


### SetLastSeenAtNil

`func (o *GetPersonPresence200ResponseDataByChannelValue) SetLastSeenAtNil(b bool)`

 SetLastSeenAtNil sets the value for LastSeenAt to be an explicit nil

### UnsetLastSeenAt
`func (o *GetPersonPresence200ResponseDataByChannelValue) UnsetLastSeenAt()`

UnsetLastSeenAt ensures that no value is present for LastSeenAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


