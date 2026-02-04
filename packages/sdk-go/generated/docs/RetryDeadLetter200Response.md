# RetryDeadLetter200Response

## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**Success** | **bool** |  | 
**DeadLetterId** | Pointer to **string** |  | [optional] 
**Error** | Pointer to **string** |  | [optional] 

## Methods

### NewRetryDeadLetter200Response

`func NewRetryDeadLetter200Response(success bool, ) *RetryDeadLetter200Response`

NewRetryDeadLetter200Response instantiates a new RetryDeadLetter200Response object
This constructor will assign default values to properties that have it defined,
and makes sure properties required by API are set, but the set of arguments
will change when the set of required properties is changed

### NewRetryDeadLetter200ResponseWithDefaults

`func NewRetryDeadLetter200ResponseWithDefaults() *RetryDeadLetter200Response`

NewRetryDeadLetter200ResponseWithDefaults instantiates a new RetryDeadLetter200Response object
This constructor will only assign default values to properties that have it defined,
but it doesn't guarantee that properties required by API are set

### GetSuccess

`func (o *RetryDeadLetter200Response) GetSuccess() bool`

GetSuccess returns the Success field if non-nil, zero value otherwise.

### GetSuccessOk

`func (o *RetryDeadLetter200Response) GetSuccessOk() (*bool, bool)`

GetSuccessOk returns a tuple with the Success field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetSuccess

`func (o *RetryDeadLetter200Response) SetSuccess(v bool)`

SetSuccess sets Success field to given value.


### GetDeadLetterId

`func (o *RetryDeadLetter200Response) GetDeadLetterId() string`

GetDeadLetterId returns the DeadLetterId field if non-nil, zero value otherwise.

### GetDeadLetterIdOk

`func (o *RetryDeadLetter200Response) GetDeadLetterIdOk() (*string, bool)`

GetDeadLetterIdOk returns a tuple with the DeadLetterId field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetDeadLetterId

`func (o *RetryDeadLetter200Response) SetDeadLetterId(v string)`

SetDeadLetterId sets DeadLetterId field to given value.

### HasDeadLetterId

`func (o *RetryDeadLetter200Response) HasDeadLetterId() bool`

HasDeadLetterId returns a boolean if a field has been set.

### GetError

`func (o *RetryDeadLetter200Response) GetError() string`

GetError returns the Error field if non-nil, zero value otherwise.

### GetErrorOk

`func (o *RetryDeadLetter200Response) GetErrorOk() (*string, bool)`

GetErrorOk returns a tuple with the Error field if it's non-nil, zero value otherwise
and a boolean to check if the value has been set.

### SetError

`func (o *RetryDeadLetter200Response) SetError(v string)`

SetError sets Error field to given value.

### HasError

`func (o *RetryDeadLetter200Response) HasError() bool`

HasError returns a boolean if a field has been set.


[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


