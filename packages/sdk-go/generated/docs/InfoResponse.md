# InfoResponse

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Version** | **string** | API version | 
**Environment** | **string** | Environment | 
**Uptime** | **int32** | Uptime in seconds | 
**Instances** | [**GetInfo200ResponseInstances**](GetInfo200ResponseInstances.md) |  | 
**Events** | [**GetInfo200ResponseEvents**](GetInfo200ResponseEvents.md) |  | 

## Methods

### NewInfoResponse

`func NewInfoResponse(version string, environment string, uptime int32, instances GetInfo200ResponseInstances, events GetInfo200ResponseEvents, ) *InfoResponse`

NewInfoResponse instantiates a new InfoResponse object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewInfoResponseWithDefaults

`func NewInfoResponseWithDefaults() *InfoResponse`

NewInfoResponseWithDefaults instantiates a new InfoResponse object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetVersion

`func (o *InfoResponse) GetVersion() string`

GetVersion returns the Version field if non-nil, zero value otherwise.

### GetVersionOk

`func (o *InfoResponse) GetVersionOk() (*string, bool)`

GetVersionOk returns a tuple with the Version field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetVersion

`func (o *InfoResponse) SetVersion(v string)`

SetVersion sets Version field to given value.


### GetEnvironment

`func (o *InfoResponse) GetEnvironment() string`

GetEnvironment returns the Environment field if non-nil, zero value otherwise.

### GetEnvironmentOk

`func (o *InfoResponse) GetEnvironmentOk() (*string, bool)`

GetEnvironmentOk returns a tuple with the Environment field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEnvironment

`func (o *InfoResponse) SetEnvironment(v string)`

SetEnvironment sets Environment field to given value.


### GetUptime

`func (o *InfoResponse) GetUptime() int32`

GetUptime returns the Uptime field if non-nil, zero value otherwise.

### GetUptimeOk

`func (o *InfoResponse) GetUptimeOk() (*int32, bool)`

GetUptimeOk returns a tuple with the Uptime field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetUptime

`func (o *InfoResponse) SetUptime(v int32)`

SetUptime sets Uptime field to given value.


### GetInstances

`func (o *InfoResponse) GetInstances() GetInfo200ResponseInstances`

GetInstances returns the Instances field if non-nil, zero value otherwise.

### GetInstancesOk

`func (o *InfoResponse) GetInstancesOk() (*GetInfo200ResponseInstances, bool)`

GetInstancesOk returns a tuple with the Instances field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetInstances

`func (o *InfoResponse) SetInstances(v GetInfo200ResponseInstances)`

SetInstances sets Instances field to given value.


### GetEvents

`func (o *InfoResponse) GetEvents() GetInfo200ResponseEvents`

GetEvents returns the Events field if non-nil, zero value otherwise.

### GetEventsOk

`func (o *InfoResponse) GetEventsOk() (*GetInfo200ResponseEvents, bool)`

GetEventsOk returns a tuple with the Events field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetEvents

`func (o *InfoResponse) SetEvents(v GetInfo200ResponseEvents)`

SetEvents sets Events field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


