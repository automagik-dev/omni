# SendPresence200Response


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**success** | **bool** |  | 
**data** | [**SendPresence200ResponseData**](SendPresence200ResponseData.md) |  | 

## Example

```python
from omni_generated.models.send_presence200_response import SendPresence200Response

# TODO update the JSON string below
json = "{}"
# create an instance of SendPresence200Response from a JSON string
send_presence200_response_instance = SendPresence200Response.from_json(json)
# print the JSON string representation of the object
print(SendPresence200Response.to_json())

# convert the object into a dict
send_presence200_response_dict = send_presence200_response_instance.to_dict()
# create an instance of SendPresence200Response from a dict
send_presence200_response_from_dict = SendPresence200Response.from_dict(send_presence200_response_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


