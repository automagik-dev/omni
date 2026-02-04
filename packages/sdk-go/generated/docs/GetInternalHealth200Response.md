# GetInternalHealth200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Status** | **string** | Health status | 
**Service** | **string** | Service name | 
**Pid** | **int32** | Process ID | 
**Memory** | [**GetInternalHealth200ResponseMemory**](GetInternalHealth200ResponseMemory.md) |  | 

## Methods

### NewGetInternalHealth200Response

`func NewGetInternalHealth200Response(status string, service string, pid int32, memory GetInternalHealth200ResponseMemory, ) *GetInternalHealth200Response`

NewGetInternalHealth200Response instantiates a new GetInternalHealth200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewGetInternalHealth200ResponseWithDefaults

`func NewGetInternalHealth200ResponseWithDefaults() *GetInternalHealth200Response`

NewGetInternalHealth200ResponseWithDefaults instantiates a new GetInternalHealth200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetStatus

`func (o *GetInternalHealth200Response) GetStatus() string`

GetStatus returns the Status field if non-nil, zero value otherwise.

### GetStatusOk

`func (o *GetInternalHealth200Response) GetStatusOk() (*string, bool)`

GetStatusOk returns a tuple with the Status field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetStatus

`func (o *GetInternalHealth200Response) SetStatus(v string)`

SetStatus sets Status field to given value.


### GetService

`func (o *GetInternalHealth200Response) GetService() string`

GetService returns the Service field if non-nil, zero value otherwise.

### GetServiceOk

`func (o *GetInternalHealth200Response) GetServiceOk() (*string, bool)`

GetServiceOk returns a tuple with the Service field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetService

`func (o *GetInternalHealth200Response) SetService(v string)`

SetService sets Service field to given value.


### GetPid

`func (o *GetInternalHealth200Response) GetPid() int32`

GetPid returns the Pid field if non-nil, zero value otherwise.

### GetPidOk

`func (o *GetInternalHealth200Response) GetPidOk() (*int32, bool)`

GetPidOk returns a tuple with the Pid field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetPid

`func (o *GetInternalHealth200Response) SetPid(v int32)`

SetPid sets Pid field to given value.


### GetMemory

`func (o *GetInternalHealth200Response) GetMemory() GetInternalHealth200ResponseMemory`

GetMemory returns the Memory field if non-nil, zero value otherwise.

### GetMemoryOk

`func (o *GetInternalHealth200Response) GetMemoryOk() (*GetInternalHealth200ResponseMemory, bool)`

GetMemoryOk returns a tuple with the Memory field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetMemory

`func (o *GetInternalHealth200Response) SetMemory(v GetInternalHealth200ResponseMemory)`

SetMemory sets Memory field to given value.



[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


