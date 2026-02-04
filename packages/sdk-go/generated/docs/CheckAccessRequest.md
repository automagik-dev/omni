# CheckAccessRequest

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**InstanceId** | **string** | Instance ID | 
**PlatformUserId** | **string** | Platform user ID | 
**Channel** | **string** | Channel type | 

## Methods

### NewCheckAccessRequest

`func NewCheckAccessRequest(instanceId string, platformUserId string, channel string, ) *CheckAccessRequest`

NewCheckAccessRequest instantiates a new CheckAccessRequest object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewCheckAccessRequestWithDefaults

`func NewCheckAccessRequestWithDefaults() *CheckAccessRequest`

NewCheckAccessRequestWithDefaults instantiates a new CheckAccessRequest object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetInstanceId

`func (o *CheckAccessRequest) GetInstanceId() string`

GetInstanceId returns the InstanceId field if non-nil, zero value otherwise.

### GetInstanceIdOk

`func (o *CheckAccessRequest) GetInstanceIdOk() (*string, bool)`

GetInstanceIdOk returns a tuple with the InstanceId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstanceId

`func (o *CheckAccessRequest) SetInstanceId(v string)`

SetInstanceId sets InstanceId field to given value.


### GetPlatformUserId

`func (o *CheckAccessRequest) GetPlatformUserId() string`

GetPlatformUserId returns the PlatformUserId field if non-nil, zero value otherwise.

### GetPlatformUserIdOk

`func (o *CheckAccessRequest) GetPlatformUserIdOk() (*string, bool)`

GetPlatformUserIdOk returns a tuple with the PlatformUserId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPlatformUserId

`func (o *CheckAccessRequest) SetPlatformUserId(v string)`

SetPlatformUserId sets PlatformUserId field to given value.


### GetChannel

`func (o *CheckAccessRequest) GetChannel() string`

GetChannel returns the Channel field if non-nil, zero value otherwise.

### GetChannelOk

`func (o *CheckAccessRequest) GetChannelOk() (*string, bool)`

GetChannelOk returns a tuple with the Channel field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetChannel

`func (o *CheckAccessRequest) SetChannel(v string)`

SetChannel sets Channel field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


