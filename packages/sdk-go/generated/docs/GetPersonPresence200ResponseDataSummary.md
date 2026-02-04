# GetPersonPresence200ResponseDataSummary

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**TotalMessages** | **int32** |  | 
**Channels** | **[]string** |  | 
**LastSeenAt** | **NullableTime** |  | 

## Methods

### NewGetPersonPresence200ResponseDataSummary

`func NewGetPersonPresence200ResponseDataSummary(totalMessages int32, channels []string, lastSeenAt NullableTime, ) *GetPersonPresence200ResponseDataSummary`

NewGetPersonPresence200ResponseDataSummary instantiates a new GetPersonPresence200ResponseDataSummary object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetPersonPresence200ResponseDataSummaryWithDefaults

`func NewGetPersonPresence200ResponseDataSummaryWithDefaults() *GetPersonPresence200ResponseDataSummary`

NewGetPersonPresence200ResponseDataSummaryWithDefaults instantiates a new GetPersonPresence200ResponseDataSummary object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetTotalMessages

`func (o *GetPersonPresence200ResponseDataSummary) GetTotalMessages() int32`

GetTotalMessages returns the TotalMessages field if non-nil, zero value otherwise.

### GetTotalMessagesOk

`func (o *GetPersonPresence200ResponseDataSummary) GetTotalMessagesOk() (*int32, bool)`

GetTotalMessagesOk returns a tuple with the TotalMessages field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetTotalMessages

`func (o *GetPersonPresence200ResponseDataSummary) SetTotalMessages(v int32)`

SetTotalMessages sets TotalMessages field to given value.


### GetChannels

`func (o *GetPersonPresence200ResponseDataSummary) GetChannels() []string`

GetChannels returns the Channels field if non-nil, zero value otherwise.

### GetChannelsOk

`func (o *GetPersonPresence200ResponseDataSummary) GetChannelsOk() (*[]string, bool)`

GetChannelsOk returns a tuple with the Channels field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannels

`func (o *GetPersonPresence200ResponseDataSummary) SetChannels(v []string)`

SetChannels sets Channels field to given value.


### GetLastSeenAt

`func (o *GetPersonPresence200ResponseDataSummary) GetLastSeenAt() time.Time`

GetLastSeenAt returns the LastSeenAt field if non-nil, zero value otherwise.

### GetLastSeenAtOk

`func (o *GetPersonPresence200ResponseDataSummary) GetLastSeenAtOk() (*time.Time, bool)`

GetLastSeenAtOk returns a tuple with the LastSeenAt field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetLastSeenAt

`func (o *GetPersonPresence200ResponseDataSummary) SetLastSeenAt(v time.Time)`

SetLastSeenAt sets LastSeenAt field to given value.


### SetLastSeenAtNil

`func (o *GetPersonPresence200ResponseDataSummary) SetLastSeenAtNil(b bool)`

 SetLastSeenAtNil sets the value for LastSeenAt to be an explicit nil

### UnsetLastSeenAt
`func (o *GetPersonPresence200ResponseDataSummary) UnsetLastSeenAt()`

UnsetLastSeenAt ensures that no value is present for LastSeenAt, not even an explicit nil

[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


